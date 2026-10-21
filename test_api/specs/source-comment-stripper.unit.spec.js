/* eslint-disable no-undef */
// `readSourceWithoutComments` (helpers/loadMeteorModule) is the substrate under ~11 source
// assertion specs, several of which are NEGATIVE - "this file does not contain that unsafe
// pattern". A negative assertion over a string is only worth something if the string is the
// real file: if the stripper deletes the code it was asked about, `not.toMatch` passes for
// free and the spec reports a guarantee it never checked.
//
// It used to do exactly that. Three regexes stood in for a scanner, and each delimiter they
// keyed on also occurs where it means nothing:
//
//   - `/*` INSIDE A LINE COMMENT opened a block comment. moduleResolver.js documents its
//     ingest paths as `POST /imports/scan/*`, so ~40 lines of it - the imports and the whole
//     first half of the resolver - were deleted before any assertion ran.
//   - `//` INSIDE A STRING ended the string. Two files carry the literal
//     `'wish by sending an email to // a request ...'`, so comment text survived into the
//     output, where a `toContain` could match it.
//
// Seven files in the repo tripped one of those. None of them happened to be read by a spec
// at the time the stripper was replaced, so nothing was silently relying on the truncation -
// but "no spec points at one of those seven files today" is not a property anything enforced,
// and pointing one at moduleResolver.js is the obvious next step for project-resolution work.
//
// So both directions are pinned here: comment text must be GONE, and code must SURVIVE.
// Asserting only the first is what let the defect live.
const fs = require('fs');
const path = require('path');
const {readSource, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const REPO_ROOT = path.join(__dirname, '../..');

// The stripper takes a repo path, so the fixtures are written to a real file and read back
// through the public function - the same way its callers use it.
const FIXTURE_DIR = 'test_api/response/.comment-stripper';
let fixtureSeq = 0;

function strip(source) {
  const relative = `${FIXTURE_DIR}/case-${fixtureSeq++}.js`;
  fs.mkdirSync(path.join(REPO_ROOT, FIXTURE_DIR), {recursive: true});
  fs.writeFileSync(path.join(REPO_ROOT, relative), source, 'utf8');
  try {
    return readSourceWithoutComments(relative);
  } finally {
    fs.unlinkSync(path.join(REPO_ROOT, relative));
  }
}

afterAll(() => {
  fs.rmSync(path.join(REPO_ROOT, FIXTURE_DIR), {recursive: true, force: true});
});

describe('comments are removed', () => {
  it.each([
    ['a whole-line comment', '// SECRET\nconst kept = 1;\n'],
    ['a trailing comment', 'const kept = 1; // SECRET\n'],
    ['a block comment', '/* SECRET */\nconst kept = 1;\n'],
    ['a multi-line block comment', '/*\n SECRET\n*/\nconst kept = 1;\n'],
    ['a JSDoc block', '/**\n * SECRET\n */\nconst kept = 1;\n'],
    ['a line comment inside a block comment', '/*\n// SECRET\n*/\nconst kept = 1;\n']
  ])('strips %s', (_label, source) => {
    const stripped = strip(source);
    expect(stripped).not.toContain('SECRET');
    // ...and the code either side of it is still there. Without this half, a stripper that
    // returned the empty string would pass every case above.
    expect(stripped).toContain('const kept = 1;');
  });

  it('strips a commented-out line of code, which is the whole point of the helper', () => {
    // The negative assertions in project-resolution / scan-ingest-contract rely on exactly
    // this: a re-introduced call must not be creditable to a comment.
    const stripped = strip([
      '// const project = await Projects.findOneAsync({companyId, name});',
      'const project = await findProjectByName({companyId, name});'
    ].join('\n'));

    expect(stripped).not.toContain('Projects.findOneAsync');
    expect(stripped).toContain('findProjectByName({companyId, name})');
  });
});

describe('code is NOT removed', () => {
  it.each([
    // The moduleResolver.js defect, reduced: a `/*` in a line comment used to run to the
    // next `*/` anywhere in the file, taking every line between them with it.
    ['a `/*` inside a line comment', [
      '// An SBOM import (POST /imports/scan/*) and a SARIF upload',
      'import Projects from \'/imports/lib/collections/projects\';',
      'const first = 1;',
      '/** JSDoc whose closing marker used to end the phantom block comment */',
      'const second = 2;'
    ].join('\n'), ['import Projects from', 'const first = 1;', 'const second = 2;']],

    ['a `*/` inside a line comment', [
      '// closes nothing: */',
      'const kept = 1;'
    ].join('\n'), ['const kept = 1;']],

    // The other direction: `//` and `/*` inside string literals are data, not comments.
    ['a `//` inside a single-quoted string', [
      'const notice = \'wish by sending an email to // a request by using the form\';',
      'const after = 1;'
    ].join('\n'), ['email to // a request by using the form', 'const after = 1;']],

    ['a `//` inside a double-quoted string', [
      'const s = "a // b";',
      'const after = 1;'
    ].join('\n'), ['"a // b"', 'const after = 1;']],

    ['a `//` inside a template literal', [
      'const s = `a // b`;',
      'const after = 1;'
    ].join('\n'), ['`a // b`', 'const after = 1;']],

    ['a `/*` inside a string', [
      'const s = \'/* not a comment\';',
      'const after = 1;'
    ].join('\n'), ['\'/* not a comment\'', 'const after = 1;']],

    ['a `*/` inside a string', [
      'const s = \'*/\';',
      'const after = 1;'
    ].join('\n'), ['const after = 1;']],

    // A `://` scheme is what the old `[^:'"`\\]` guard was reaching for; it has to keep
    // working, and now it works because it is inside a string, not because of the colon.
    ['a URL in a string', [
      'const url = \'https://example.test/a//b\';',
      'const after = 1;'
    ].join('\n'), ['https://example.test/a//b', 'const after = 1;']],

    ['a bare `://` outside a string', [
      'const scheme = x ? y : //comment',
      '  z;'
    ].join('\n'), ['const scheme = x ? y :', 'z;']],

    // Regex literals contain both delimiters and must survive whole, or a `not.toMatch`
    // against a validation pattern would pass because the pattern was eaten.
    ['a regex literal containing `//`', [
      'const re = /https?:\\/\\//;',
      'const after = 1;'
    ].join('\n'), ['const re = /https?:\\/\\//;', 'const after = 1;']],

    ['a regex literal containing `/*`', [
      'const re = /a\\/\\*b/;',
      'const after = 1;'
    ].join('\n'), ['const re = /a\\/\\*b/;', 'const after = 1;']],

    ['a regex after `return`', [
      'function f() { return /\\/\\//.test(s); }',
      'const after = 1;'
    ].join('\n'), ['return /\\/\\//.test(s);', 'const after = 1;']],

    ['a regex with a `/` inside a character class', [
      'const re = /[/*]+/g;',
      'const after = 1;'
    ].join('\n'), ['const re = /[/*]+/g;', 'const after = 1;']],

    ['division that is not a regex', [
      'const half = total / 2; // SECRET',
      'const after = 1;'
    ].join('\n'), ['const half = total / 2;', 'const after = 1;']],

    ['an escaped quote inside a string', [
      'const s = \'it\\\'s // fine\';',
      'const after = 1;'
    ].join('\n'), ['const after = 1;']]
  ])('keeps code past %s', (_label, source, mustSurvive) => {
    const stripped = strip(source);
    mustSurvive.forEach((fragment) => expect(stripped).toContain(fragment));
  });

  it('keeps line numbering, so `^...$` anchored assertions still address the right line', () => {
    const source = ['/*', ' * four', ' * line', ' */', 'const onLineFive = 1;'].join('\n');

    const stripped = strip(source);

    expect(stripped.split('\n').length).toEqual(source.split('\n').length);
    expect(stripped.split('\n')[4]).toEqual('const onLineFive = 1;');
    expect(stripped).not.toContain('four');
  });

  it('an unterminated quote does not swallow the rest of the file', () => {
    // Defensive: a scanner that ran to EOF looking for a closing quote would silently
    // truncate, which is the failure mode this whole spec exists to prevent.
    const stripped = strip('const broken = \'oops;\nconst after = 1;\n');

    expect(stripped).toContain('const after = 1;');
  });
});

// --- against the real files, not just fixtures ------------------------------------------
describe('the real sources the source-assertion specs read survive stripping', () => {
  // moduleResolver.js is the file the defect actually truncated. project-resolution.unit
  // .spec.js had to fall back to RAW source to assert anything about it; this is the
  // regression test that keeps the stripped form usable.
  it('moduleResolver.js keeps its imports and its resolver functions', () => {
    const stripped = readSourceWithoutComments('imports/server/rest-api/moduleResolver.js');

    ['import Modules from', 'import Projects from', 'import {findProjectByName}',
      'export async function resolveProjectRef', 'export async function resolveModuleRef']
      .forEach((fragment) => expect(stripped).toContain(fragment));

    // ...and the header comment that used to eat them is gone.
    expect(stripped).not.toContain('One module resolver for every ingest path');
  });

  it.each([
    'imports/server/rest-api/scans.js',
    'imports/server/rest-api/check.js',
    'imports/server/rest-api/projects.js',
    'imports/server/rest-api/projectResolver.js',
    'imports/server/rest-api/moduleResolver.js'
  ])('%s loses no import statement', (file) => {
    const raw = readSource(file);
    const stripped = readSourceWithoutComments(file);
    // Line-anchored so a commented-out import is not counted on either side.
    const imports = (raw.match(/^import .*;$/gm) || []);

    expect(imports.length).toBeGreaterThan(0);
    imports.forEach((statement) => expect(stripped).toContain(statement));
  });

  it('no file under imports/server/rest-api loses a declaration', () => {
    // The blast radius of the old defect was "any file whose comments happen to contain a
    // `/*`", which is not something a reviewer can eyeball. Sweeping the whole REST surface -
    // where the negative security assertions live - turns that into something checkable.
    //
    // Each declaration is checked by its PREFIX, up to the first `//` or `/*` on the line.
    // A prefix is used rather than the whole line because a line may legitimately end in a
    // comment, and it is still sound: the bytes before a comment are untouched by stripping,
    // so a prefix that has gone missing means the line itself was deleted.
    const dir = path.join(REPO_ROOT, 'imports/server/rest-api');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js'));
    let checked = 0;

    expect(files.length).toBeGreaterThan(10);
    files.forEach((name) => {
      const relative = `imports/server/rest-api/${name}`;
      const stripped = readSourceWithoutComments(relative);
      readSource(relative).split('\n')
        .map((line) => line.trim())
        .filter((line) => /^(?:export\s+)?(?:async\s+)?(?:import|export|const|let|var|function)\s/.test(line))
        .map((line) => line.split(/\/\/|\/\*/)[0].trim())
        .filter((prefix) => prefix.length >= 12)
        .forEach((prefix) => {
          checked++;
          expect(stripped).toContain(prefix);
        });
    });

    // Without this the sweep would report success on an empty file list or a regex that
    // stopped matching anything - the same vacuity the whole spec is about.
    expect(checked).toBeGreaterThan(200);
  });
});
