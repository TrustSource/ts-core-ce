/* eslint-disable no-undef */
// Load a Meteor-coupled ES module under plain Jest.
//
// The established local pattern for testing Meteor-coupled code is to extract the pure logic
// into a CommonJS module (see spdx/licenseKey.js, lib/user/displayName.js) and unit-test that.
// Some pure logic lives in a file that cannot be split that way - `imports/client/ui/lib/
// ListHelper.js` exports one object whose Meteor-free methods sit next to Meteor-using ones.
// Re-typing those methods into a spec would be testing a copy, so instead the REAL source is
// loaded: the `import` lines are swapped for caller-supplied stubs and `export` is turned into
// a CommonJS export, then the file is evaluated in a `vm` context.
//
// This executes production code, so a change to the function under test is caught. It is
// deliberately strict about the two rewrites it performs: if the module stops looking like
// `import ... from '...'` + `export const X = ...`, loading throws with a clear message rather
// than silently exporting nothing (which would make every assertion vacuously pass).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '../..');

const IMPORT_LINE = /^\s*import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|([\w$]+)|\*\s*as\s+([\w$]+))\s+from\s+['"]([^'"]+)['"];?\s*$/;
const BARE_IMPORT_LINE = /^\s*import\s+['"][^'"]+['"];?\s*$/;

// A named-import list wrapped over several lines - which prettier/eslint produce
// as soon as the list passes the line-length limit:
//
//   import {planCweRisks, desiredPrevCount,
//     SARIF_RECONCILE_MAX_TESTS} from '/imports/lib/sarif/cweRiskPlan';
//
// The rewrite below is line-based, so such a statement would reach the vm
// verbatim and die with a SyntaxError. Folding the braces back onto one line
// first is a no-op for every import that already fits on one (there is no
// newline to collapse), so this cannot change how any existing caller loads.
const MULTILINE_NAMED_IMPORT = /^[ \t]*import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/gm;

function foldMultilineImports(source) {
  return source.replace(MULTILINE_NAMED_IMPORT, function (statement) {
    const wrapped = (statement.match(/\n/g) || []).length;
    // The newlines are put back AFTER the folded statement so every later line
    // keeps its original number and a vm stack trace still points at real code.
    return statement.replace(/\s*\r?\n\s*/g, ' ') + '\n'.repeat(wrapped);
  });
}

// `import Default, {a, b as c} from 'spec'` -> const declarations pulling from `__deps['spec']`.
function rewriteImport(match) {
  const [, defaultWithNamed, named, defaultOnly, namespace, specifier] = match;
  const source = `__deps[${JSON.stringify(specifier)}]`;
  const parts = [];
  const defaultName = defaultWithNamed || defaultOnly;
  if (defaultName) {
    // Interop: a CommonJS stub object IS the default export.
    parts.push(`const ${defaultName} = (${source} && ${source}.default !== undefined) ? ${source}.default : ${source};`);
  }
  if (namespace) {
    parts.push(`const ${namespace} = ${source};`);
  }
  if (named !== undefined && named.trim()) {
    const bindings = named.split(',').map(function (entry) {
      const [imported, local] = entry.split(/\s+as\s+/).map(function (s) { return s.trim(); });
      return local ? `${imported}: ${local}` : imported;
    }).filter(Boolean).join(', ');
    parts.push(`const {${bindings}} = ${source};`);
  }
  return parts.join(' ');
}

/**
 * @param {string} relativePath  repo-relative path of the module to load
 * @param {object} deps          map of import specifier -> stub module object
 * @param {object} [options]     {allowNoExports} for modules that only register side effects
 *                               (Meteor.publish / Meteor.methods / Collection.allow) and whose
 *                               behaviour is captured through the stubs instead.
 *                               {globals} adds free variables the module uses without importing
 *                               them (e.g. Buffer, fetch), so a test can supply or trap them.
 * @returns {object}             the module's named exports
 */
// Stubs every load gets unless the caller supplies its own. Only pure, side-effect-free
// modules belong here: /imports/config is plain settings, read by many files only for the
// app name and the installation address.
const DEFAULT_DEPS = {
  '/imports/config': {Config: {name: 'TrustSource CE', version: '1.0.0', appUrl: 'https://ts.example.org/'}}
};

function loadMeteorModule(relativePath, callerDeps, options) {
  const deps = Object.assign({}, DEFAULT_DEPS, callerDeps);
  const absolute = path.join(REPO_ROOT, relativePath);
  const source = fs.readFileSync(absolute, 'utf8');
  const allowNoExports = !!(options && options.allowNoExports);

  const rewritten = foldMultilineImports(source).split('\n').map(function (line) {
    if (BARE_IMPORT_LINE.test(line)) return '';
    const match = line.match(IMPORT_LINE);
    if (!match) return line;
    if (!Object.prototype.hasOwnProperty.call(deps, match[5])) {
      throw new Error(`loadMeteorModule(${relativePath}): no stub supplied for import '${match[5]}'`);
    }
    return rewriteImport(match);
  }).join('\n');

  // {exported, local} pairs, so an aliased re-export keeps its published name.
  const exportNames = [];
  const withExports = rewritten
    .replace(/^export\s+(const|let|var|function|class|async\s+function)\s+([\w$]+)/gm, function (whole, kind, name) {
      exportNames.push({exported: name, local: name});
      return `${kind} ${name}`;
    })
    // `export {A, B as C};` - a re-export list, whose names are already bound in
    // scope (they came from a rewritten import, or from a declaration above).
    // Dropping the statement and recording the names is enough; without this the
    // vm sees a bare `export` and throws SyntaxError. A re-export that names a
    // module (`export {A} from '...'`) is deliberately NOT matched - it would
    // need its own dep stub, and silently ignoring it would export undefined.
    .replace(/^export\s*\{([^}]*)\}\s*;?\s*$/gm, function (whole, names) {
      names.split(',').map(function (entry) { return entry.trim(); }).filter(Boolean)
        .forEach(function (entry) {
          const parts = entry.split(/\s+as\s+/).map(function (part) { return part.trim(); });
          exportNames.push({local: parts[0], exported: parts[1] || parts[0]});
        });
      return '';
    })
    .replace(/^export\s+default\s+/gm, 'const __default = ');

  if (!allowNoExports && !exportNames.length && !/const __default = /.test(withExports)) {
    throw new Error(`loadMeteorModule(${relativePath}): no ES export found - the module shape changed`);
  }

  const exportsAssignment = '\n;module.exports = {' +
    exportNames.map(function (entry) { return `${entry.exported}: ${entry.local}`; }).join(', ') +
    (/const __default = /.test(withExports) ? (exportNames.length ? ', ' : '') + 'default: __default' : '') +
    '};\n';

  const sandbox = {
    __deps: deps,
    module: {exports: {}},
    console: console,
    Object: Object,
    Array: Array,
    JSON: JSON,
    Set: Set,
    Map: Map,
    Date: Date,
    RegExp: RegExp,
    Error: Error,
    String: String,
    Number: Number,
    Boolean: Boolean,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    Promise: Promise
  };
  Object.assign(sandbox, (options && options.globals) || {});
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(withExports + exportsAssignment, sandbox, {filename: absolute});
  return sandbox.module.exports;
}

// Comments can only be recognised by scanning the file the way JavaScript reads it, because
// every delimiter also occurs inside something that is NOT a comment. The three regexes this
// replaced could not see that context and got it wrong in both directions:
//
//   `// ...(POST /imports/scan/*)...`   the `/*` inside a LINE comment opened a block comment
//                                       that ran to the next `*/`, deleting ~40 lines of real
//                                       code from moduleResolver.js - and a `not.toMatch`
//                                       over deleted code passes for free
//   `'wish ... email to // a request'`  a `//` inside a STRING truncated the string, so the
//                                       comment text left behind could satisfy a `toContain`
//
// Both failures are silent: the caller gets a string back either way. Seven files in the repo
// tripped one of them. So this is a scanner, not a substitution - it tracks which construct it
// is inside (string, template literal, regex literal, comment) and only removes the comments.
//
// Verified against acorn's own comment ranges over every .js file in the repo: identical
// output on 1949 of 1950 files, the one difference being a `#!` shebang, which acorn reports
// as a comment and this deliberately keeps. source-comment-stripper.unit.spec.js pins the
// cases above.
const REGEX_MAY_FOLLOW = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void',
  'instanceof', 'new', 'do', 'else', 'yield', 'await', 'throw']);

// Comments are blanked rather than removed so that every following line keeps its original
// number and `^...$` line-anchored assertions still mean what they say.
function blankOut(text) {
  return text.replace(/[^\n]/g, '');
}

/**
 * Read a repo file and strip its comments, so a text assertion cannot false-pass on a
 * commented-out line - and, just as importantly, cannot vacuously pass because real code
 * was mistaken for a comment and deleted.
 *
 * @param  {String} relativePath path from the repo root
 * @return {String} the source with comment text replaced by blanks, line numbering intact
 */
function readSourceWithoutComments(relativePath) {
  const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
  let out = '';
  let i = 0;
  let prevChar = '';   // last significant character, for the regex-vs-division decision
  let prevWord = '';   // ...and the identifier it belongs to, so `return /re/` is a regex

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      const start = i;
      while (i < source.length && source[i] !== '\n') { i++; }
      out += blankOut(source.slice(start, i));
      continue;
    }

    if (char === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { i++; }
      i = Math.min(i + 2, source.length);
      out += blankOut(source.slice(start, i));
      continue;
    }

    // A string or template literal is copied through verbatim: nothing inside one is a comment.
    if (char === '"' || char === '\'' || char === '`') {
      out += char;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { out += source[i] + (source[i + 1] || ''); i += 2; continue; }
        if (source[i] === char) { out += source[i]; i++; break; }
        // An unterminated quote must not swallow the rest of the file; a template literal
        // is the only one of the three that legitimately spans lines.
        if (char !== '`' && source[i] === '\n') { break; }
        out += source[i];
        i++;
      }
      prevChar = char;
      prevWord = '';
      continue;
    }

    // `/` opens a regex literal unless the previous token could end an expression, in which
    // case it is division. Copied verbatim so a `//` or `/*` inside the pattern is not read
    // as a comment.
    if (char === '/') {
      const isDivision = /[\w$)\]]/.test(prevChar) && !REGEX_MAY_FOLLOW.has(prevWord);
      if (!isDivision) {
        out += char;
        i++;
        let inCharClass = false;
        while (i < source.length) {
          const inner = source[i];
          if (inner === '\\') { out += inner + (source[i + 1] || ''); i += 2; continue; }
          if (inner === '\n') { break; }
          out += inner;
          i++;
          if (inner === '[') { inCharClass = true; }
          else if (inner === ']') { inCharClass = false; }
          else if (inner === '/' && !inCharClass) { break; }
        }
        prevChar = '/';
        prevWord = '';
        continue;
      }
    }

    out += char;
    if (!/\s/.test(char)) {
      prevChar = char;
      prevWord = /[\w$]/.test(char) ? prevWord + char : '';
    }
    i++;
  }
  return out;
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

module.exports = {loadMeteorModule, readSource, readSourceWithoutComments};
