// ---------------------------------------------------------------------------
// What can the BROWSER actually see?
//
// The CSAF product_id codec lives under imports/server/ so that the browser
// bundle never carries it. The only verification of that
// property so far has been a manual `yarn meteor-build` plus a grep, run once by
// hand before release, and an existing Jest guard
// (csaf-product-id-wiring.source.unit.spec.js) that walks outward from every file
// under imports/client/.
//
// Walking from imports/client/ is the wrong root. Meteor's client bundle is not
// "the files under imports/client/" - it is the transitive closure of
// client/main.js (plus anything else eagerly loaded from client/). That closure
// includes all of imports/lib/, imports/api/, imports/startup/client/ and
// imports/config.js, none of which live under imports/client/. imports/lib/converter/vex.js,
// for one, is only reached by the imports/client/ walk because something under
// imports/client/ happens to import it.
//
// So this spec walks the REAL entry point and asserts two things about every
// file the browser can reach:
//   1. none of them lives in a `server/` directory;
//   2. none of them imports a CryptoJS module.
//
// It is a static approximation of the bundle, deliberately an OVER-approximation:
// comments are stripped before imports are extracted (so a commented-out import
// is not counted), but nothing is pruned for `Meteor.isServer` guards or lazy
// loading, because Meteor does not prune those either. An absence proved over a
// superset is an absence in the bundle.
//
// A walker that silently skips what it cannot resolve proves nothing, so an
// unresolvable repo-relative import fails this spec, and the walker is put
// through a fixture that DOES violate every rule to show it can still say no.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');

// CryptoJS modules that must never reach the browser.
const FORBIDDEN_PACKAGES = ['crypto-js/rabbit', 'crypto-js/enc-utf8', 'crypto-js'];

// The helpers vex.js used to export. Their absence from the browser is what makes
// a published product_id irreversible.
const REMOVED_HELPERS = ['moduleIdToProductId', 'productIdToModuleId'];

// Extensions tried, in order, when resolving a repo-relative specifier. `.html`
// matters: Blaze templates are imported by name with no extension
// (imports/client/ui/approves/index.js does exactly this).
const RESOLVE_ORDER = [
  '', '.js', '.ts', '.jsx', '.json', '.html',
  '/index.js', '/index.ts', '/index.jsx', '/index.html'
];

// Only these are parsed for further imports. A .html Blaze template or a
// stylesheet is recorded as reached but has no JS import graph of its own.
const WALKABLE = /\.(?:js|jsx|ts)$/;

// Always use forward slashes in anything an assertion looks at, so a failure
// message and a path comparison read the same on any host OS.
function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Comment-aware: block and line comments are removed before specifiers are
// extracted, so a commented-out `import 'crypto-js/rabbit'` is neither followed
// nor reported. String literals containing `//` (URLs) survive this because only
// a `//` that is not inside quotes is treated as a comment start.
function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next === undefined ? '' : next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// `import x from 's'` / `import {a} from 's'` / `import 's'` /
// `export * from 's'` / `export {a} from 's'` / `require('s')` / `import('s')`.
const SPECIFIER_RE = new RegExp([
  'import\\s*\\(\\s*[\'"]([^\'"]+)[\'"]\\s*\\)',
  'require\\s*\\(\\s*[\'"]([^\'"]+)[\'"]\\s*\\)',
  '(?:^|[;}\\s])import\\s+[^;\'"]*from\\s*[\'"]([^\'"]+)[\'"]',
  '(?:^|[;}\\s])import\\s*[\'"]([^\'"]+)[\'"]',
  '(?:^|[;}\\s])export\\s+(?:\\*|\\{[^}]*\\})\\s*from\\s*[\'"]([^\'"]+)[\'"]'
].join('|'), 'g');

function specifiersOf(source) {
  const found = [];
  const clean = stripComments(source);
  let match = SPECIFIER_RE.exec(clean);
  while (match !== null) {
    found.push(match.slice(1).find((group) => group !== undefined));
    match = SPECIFIER_RE.exec(clean);
  }
  SPECIFIER_RE.lastIndex = 0;
  return found;
}

/**
 * Walk the import graph from `roots`.
 *
 * @returns {{files: string[], packages: string[], unresolved: string[]}}
 *          `files` are repo-relative POSIX paths; `packages` are bare npm
 *          specifiers (not followed); `unresolved` are repo-relative specifiers
 *          that resolved to nothing - always a bug in this walker or a dead
 *          import in the tree, and either way it must be empty.
 */
function walkImportGraph(rootDir, roots) {
  const visited = new Set();
  const packages = new Set();
  const unresolved = new Set();
  const queue = roots.slice();

  const resolve = (spec, fromFile) => {
    // Meteor packages are not app source and have no file in the tree.
    if (spec.startsWith('meteor/')) return {kind: 'meteor'};
    let base;
    if (spec.startsWith('.')) {
      base = path.resolve(path.dirname(fromFile), spec);
    } else if (spec.startsWith('/')) {
      base = path.join(rootDir, spec);
    } else {
      return {kind: 'package'};
    }
    for (const suffix of RESOLVE_ORDER) {
      const candidate = base + suffix;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return {kind: 'file', file: candidate};
      }
    }
    return {kind: 'unresolved'};
  };

  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!WALKABLE.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of specifiersOf(source)) {
      const result = resolve(spec, file);
      if (result.kind === 'package') packages.add(spec);
      else if (result.kind === 'unresolved') {
        unresolved.add(`${spec}  (imported by ${toPosix(path.relative(rootDir, file))})`);
      } else if (result.kind === 'file') queue.push(result.file);
    }
  }

  return {
    files: [...visited].map((file) => toPosix(path.relative(rootDir, file))).sort(),
    packages: [...packages].sort(),
    unresolved: [...unresolved].sort()
  };
}

// Everything Meteor loads eagerly on the client: every .js directly under
// client/. That is the true bundle root set, not imports/client/.
function clientRoots(rootDir) {
  const clientDir = path.join(rootDir, 'client');
  return fs.readdirSync(clientDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(clientDir, name));
}

// Computed ONCE, at module load, and shared by every test below - not rebuilt per
// assertion. A ~1400-file walk repeated per test would be the slow kind of guard
// nobody keeps.
const ROOTS = clientRoots(REPO_ROOT);
const GRAPH = walkImportGraph(REPO_ROOT, ROOTS);
const SOURCES = new Map(
  GRAPH.files
    .filter((rel) => /\.(?:js|jsx|ts|html)$/.test(rel))
    .map((rel) => [rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')]));

function reachableFilesContaining(needle) {
  return [...SOURCES.entries()]
    .filter(([, source]) => source.includes(needle))
    .map(([rel]) => rel);
}

// ---------------------------------------------------------------------------

describe('the browser-bundle walk is real', () => {
  it('starts from client/main.js, the actual Meteor client entry', () => {
    expect(ROOTS.map((file) => toPosix(path.relative(REPO_ROOT, file)))).toContain('client/main.js');
    expect(fs.readFileSync(path.join(REPO_ROOT, 'client/main.js'), 'utf8'))
      .toContain('/imports/startup/client');
  });

  it('reached a whole application, not a handful of files', () => {
    // Non-vacuity floor. The real closure is ~1400 files; a walk that collapsed to
    // a few dozen would silently make every absence assertion below meaningless.
    expect(GRAPH.files.length).toBeGreaterThan(500);
  });

  it('reached the specific files this change is about', () => {
    // vex.js is the file that used to hold the secret, and it is NOT under
    // imports/client/ - which is precisely why the entry-point walk matters.
    expect(GRAPH.files).toContain('imports/lib/converter/vex.js');
    expect(GRAPH.files).toContain('imports/client/ui/csaf/csaf-create.js');
    expect(GRAPH.files).toContain('imports/client/ui/common/vex-by-report/vex-by-report.js');
    expect(GRAPH.files).toContain('imports/client/ui/reports/report-vulnerability/report-vulnerability.js');
  });

  it('resolved every repo-relative import it met', () => {
    // A walker that shrugs at what it cannot resolve proves nothing: the one
    // unresolvable edge could be the one leading to the secret.
    expect(GRAPH.unresolved).toEqual([]);
  });

  it('recognised npm packages without following them', () => {
    expect(GRAPH.packages).toContain('underscore');
    expect(GRAPH.packages).toContain('nanoid');
  });
});

describe('no server-side file is reachable from the browser', () => {
  it('no reached file lives in a `server/` directory', () => {
    expect(GRAPH.files.filter((rel) => /(?:^|\/)server\//.test(rel))).toEqual([]);
  });

  it('NON-VACUITY: the server files it must not reach do exist on disk', () => {
    // Otherwise the assertion above would pass for a build where the codec had
    // simply been deleted.
    ['imports/server/csaf/productId.js',
      'imports/server/csaf/productIdCodec.js',
      'imports/server/csaf/ownership.js',
      'imports/server/csaf/productIdMethods.js'].forEach((rel) => {
      expect(fs.existsSync(path.join(REPO_ROOT, rel))).toBe(true);
    });
  });

  it('the csaf interactor barrel (which re-exports remove.js) is not reachable', () => {
    // remove.js imports the server codec; the barrel is the one path by which a
    // client file could pull it in.
    expect(GRAPH.files).not.toContain('imports/lib/interactors/csaf/index.js');
    expect(GRAPH.files).not.toContain('imports/lib/interactors/csaf/remove.js');
  });

  it('csaf-import-modal.js still imports .../csaf/create directly, bypassing the barrel', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'imports/client/ui/csaf/csaf-import-modal.js'), 'utf8');
    expect(stripComments(source)).toMatch(/from\s*'\/imports\/lib\/interactors\/csaf\/create'/);
  });
});

describe('the product_id codec is unreachable from the browser', () => {
  it('no reached file imports a crypto-js module', () => {
    const hits = FORBIDDEN_PACKAGES.filter((pkg) => GRAPH.packages.includes(pkg));
    expect(hits).toEqual([]);
  });

  it('the removed vex.js crypto helpers are named nowhere the browser can reach', () => {
    REMOVED_HELPERS.forEach((name) => {
      expect(reachableFilesContaining(name)).toEqual([]);
    });
  });

  it('NON-VACUITY: a name that IS still shipped is found by the same search', () => {
    // If reachableFilesContaining() were broken, the assertion above would pass
    // for every string in existence.
    expect(reachableFilesContaining('fromVulnerabilityReport'))
      .toContain('imports/lib/converter/vex.js');
  });

  it('nor does it reach the browser by any route OUTSIDE the import graph', () => {
    // The import-graph walk is not the whole browser surface. Meteor also ships
    // the 8 custom packages under packages/ (bundled by its own package system,
    // not by an import edge), everything eagerly loaded from client/, and every
    // byte of public/ as a static asset. An isolation claim that only checked the
    // graph would miss all three.
    const roots = ['packages', 'public', 'client', 'locales'];
    const offenders = [];
    roots.forEach((root) => {
      const dir = path.join(REPO_ROOT, root);
      if (!fs.existsSync(dir)) return;
      (function walk(current) {
        fs.readdirSync(current, {withFileTypes: true}).forEach((entry) => {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.npm') return;
            walk(full);
            return;
          }
          let source;
          try {
            source = fs.readFileSync(full, 'utf8');
          } catch (error) {
            return;   // binary asset, nothing to match
          }
          if (/require\(['"]crypto-js/.test(source)
            || /from\s+['"]crypto-js/.test(source)) {
            offenders.push(toPosix(path.relative(REPO_ROOT, full)));
          }
        });
      })(dir);
    });
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The walker is only worth its assertions if it can still fail. Point it at a
// fixture that breaks every rule at once and confirm it says so.
//
// The fixture mirrors the real topology - a client/ entry that imports an
// /imports/-absolute shared module, which in turn reaches a server file, a Blaze
// template imported without an extension, and an npm package - so it exercises
// the same resolution paths the real walk takes, not an idealised subset.
// ---------------------------------------------------------------------------
describe('NON-VACUITY: the walker detects a violation when one exists', () => {
  let fixtureRoot;
  let fixtureGraph;

  beforeAll(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'client-graph-fixture-'));
    const write = (rel, body) => {
      const full = path.join(fixtureRoot, rel);
      fs.mkdirSync(path.dirname(full), {recursive: true});
      fs.writeFileSync(full, body);
    };
    write('client/main.js', "import '/imports/startup/client';\n");
    write('imports/startup/client/index.js', [
      "import '/imports/lib/shared';",
      "import './widget';",
      ''
    ].join('\n'));
    // Extension-less Blaze template import, exactly as the real tree does it.
    write('imports/startup/client/widget.html', '<template name="widget"></template>');
    write('imports/lib/shared.js', [
      "import RABBIT from 'crypto-js/rabbit';",
      "import {decodeProductId} from '/imports/server/csaf/productId';",
      "// import 'crypto-js/enc-utf8';   <- commented out: must NOT be counted",
      'export const productIdToModuleId = (t) => decodeProductId(t) || RABBIT;',
      ''
    ].join('\n'));
    write('imports/server/csaf/productId.js',
      "export const decodeProductId = () => undefined;\n");
    fixtureGraph = walkImportGraph(fixtureRoot, clientRoots(fixtureRoot));
  });

  afterAll(() => {
    fs.rmSync(fixtureRoot, {recursive: true, force: true});
  });

  it('resolves the fixture cleanly, including the extension-less template', () => {
    expect(fixtureGraph.unresolved).toEqual([]);
    expect(fixtureGraph.files).toContain('imports/startup/client/widget.html');
  });

  it('flags the reachable server file', () => {
    expect(fixtureGraph.files.filter((rel) => /(?:^|\/)server\//.test(rel)))
      .toEqual(['imports/server/csaf/productId.js']);
  });

  it('flags the reachable crypto-js import', () => {
    expect(fixtureGraph.packages).toContain('crypto-js/rabbit');
  });

  it('flags the reachable removed helper name', () => {
    const hits = fixtureGraph.files.filter((rel) => /\.(?:js|jsx|ts)$/.test(rel)
      && fs.readFileSync(path.join(fixtureRoot, rel), 'utf8').includes('productIdToModuleId'));
    expect(hits).toEqual(['imports/lib/shared.js']);
  });

  it('does NOT count the commented-out import', () => {
    // Both directions: crypto-js/rabbit is a live import and IS reported;
    // crypto-js/enc-utf8 appears only in a comment and is NOT.
    expect(fixtureGraph.packages).toContain('crypto-js/rabbit');
    expect(fixtureGraph.packages).not.toContain('crypto-js/enc-utf8');
  });

  it('reports an unresolvable repo-relative import instead of skipping it', () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'client-graph-broken-'));
    try {
      fs.mkdirSync(path.join(broken, 'client'), {recursive: true});
      fs.writeFileSync(path.join(broken, 'client/main.js'), "import '/imports/does-not-exist';\n");
      const graph = walkImportGraph(broken, clientRoots(broken));
      expect(graph.unresolved).toHaveLength(1);
      expect(graph.unresolved[0]).toContain('/imports/does-not-exist');
      expect(graph.unresolved[0]).toContain('client/main.js');
    } finally {
      fs.rmSync(broken, {recursive: true, force: true});
    }
  });
});
