/* eslint-disable no-undef */
// Regressions seen on a fresh installation (GitHub issues #1, #2, #3).
//
// Source-text assertions: generateDemoData, the i18n client setup and the riskProperties
// startup hook all need a running Meteor server, which this jest suite does not have. The
// behaviour behind them is exercised against the real modules in
// fresh-install-issues.unit.spec.js; this file pins the wiring that cannot be loaded.
//
// Comments are stripped with the repo's scanner (helpers/loadMeteorModule), not a regex: the
// files read here carry comments that name the very calls under assertion, and a regex
// stripper also eats `//` inside strings and URLs (see source-comment-stripper.unit.spec.js).
const fs = require('fs');
const path = require('path');
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const REPO = path.join(__dirname, '../..');

// A slice between two markers. Throws when a marker is missing, so a renamed method can never
// turn every assertion below into a match against an empty or unrelated string.
function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`marker not found: ${startMarker}`);
  }
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  if (end < 0) {
    throw new Error(`marker not found after ${startMarker}: ${endMarker}`);
  }
  return source.slice(start, end);
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

describe('Load demo project processes and analyses the demo scan (#1, #2)', () => {
  const src = readSourceWithoutComments('imports/server/collections/projects.js');
  const body = between(src, 'generateDemoData:', 'removeDemoData:');

  it('reads the real method body (positive control)', () => {
    // Live tokens of generateDemoData that are unrelated to the fix. If these vanish the slice
    // is wrong and every assertion below would be checking the wrong text.
    expect(body).toContain('DemoData.getDemoScan(scanId, moduleData, user2)');
    expect(body).toContain('await Modules.insertAsync(module)');
    expect(body).toContain('await Scans.insertAsync(scan)');
  });

  it('imports processScan from the scan pipeline as live code', () => {
    expect(src).toMatch(/^import processScan from '\/imports\/server\/scan\/processScan';$/m);
  });

  it('runs processScan on the inserted demo scan, as the demo user of that company', () => {
    // Without processScan the dependencies never reach the component catalogue, so the
    // analysis finds no component and every license is reported as "unknown".
    // `true` is the demo flag: a module processScan has to create is then marked demo and
    // removeDemoData cleans it up.
    expect(body).toMatch(/processScan\(\s*scanId\s*,\s*user3\s*,\s*companyId\s*,\s*true\s*\)/);
    expect(body).toMatch(/const companyId\s*=\s*user3\.profile\.companyId;/);
    expect(body.indexOf('Scans.insertAsync(scan)')).toBeLessThan(body.indexOf('processScan('));
  });

  it('calls processScan exactly once, and only inside the deferred callback', () => {
    expect(count(body, 'processScan(')).toBe(1);
    // A rejected processScan inside Meteor.defer is caught and logged, not left to surface as
    // an unhandled rejection after the method has already answered.
    expect(body).toMatch(
      /Meteor\.defer\(async function \(\) \{\s*try \{\s*await processScan\([^)]*\);\s*\} catch \((\w+)\) \{\s*console\.(?:log|error)\([^)]*\1\);\s*\}\s*\}\);/);
  });

  it('defers processing inside the try that inserted the scan, so a failed insert never processes', () => {
    const tryBlock = between(body, 'await Scans.insertAsync(scan);', "console.log('Error Scans.insert'");
    expect(tryBlock).toContain('Meteor.defer(');
    expect(tryBlock).toContain('processScan(');
  });

  it('ties the scan to the created module before it is stored', () => {
    expect(body).toMatch(/scan\.projectId\s*=\s*data;/);
    expect(body).toMatch(/scan\.moduleIdentifier\s*=\s*module\.moduleIdentifier;/);
    // Assigned after the scan object exists and BEFORE the insert: set afterwards, the stored
    // document would still carry getDemoScan's own identifier and no projectId, and
    // processScan (which re-reads the scan from the collection) would create a second module.
    const insertAt = body.indexOf('await Scans.insertAsync(scan)');
    const createdAt = body.indexOf('DemoData.getDemoScan(');
    ['scan.projectId', 'scan.moduleIdentifier'].forEach(function (field) {
      const at = body.indexOf(field);
      expect(at).toBeGreaterThan(createdAt);
      expect(at).toBeLessThan(insertAt);
    });
  });

  it('`data` and `module` are the project id and module document of this same call', () => {
    expect(body).toMatch(/const data = await Projects\.insertAsync\(projectBase\);/);
    expect(body).toMatch(/module\.projectId = data;/);
    expect(body).toMatch(/let module = new Module\([^;]*Utils\.generateModuleIdentifier\('Demo module'\)\);/);
  });
});

describe('No i18n locale call before sign-in (#3)', () => {
  const src = readSourceWithoutComments('imports/startup/client/index.js');

  it('disables sameLocaleOnServerConnection in the client startup', () => {
    expect(src).toMatch(/^i18n\.setOptions\(\{\s*sameLocaleOnServerConnection:\s*false\s*\}\);$/m);
  });

  it('turns it off before the first setLocale the client startup can trigger', () => {
    const off = src.indexOf('sameLocaleOnServerConnection');
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(src.indexOf('Tracker.autorun('));
    expect(off).toBeLessThan(src.indexOf('i18n.setLocale('));
  });

  it('nothing else in the app turns it back on', () => {
    // universe:i18n merges options (Object.assign), so a later setOptions only reverts the
    // flag if it names it. Every live mention in the app must be the one above.
    const hits = [];
    function walk(dir) {
      fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach(function (entry) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') { walk(rel); }
          return;
        }
        if (!/\.(js|mjs)$/.test(entry.name)) { return; }
        // Cheap prefilter on the raw text; the count is taken on live code only.
        if (!fs.readFileSync(path.join(REPO, rel), 'utf8').includes('sameLocaleOnServerConnection')) {
          return;
        }
        const live = count(readSourceWithoutComments(rel), 'sameLocaleOnServerConnection');
        if (live > 0) { hits.push([rel, live]); }
      });
    }
    ['imports', 'client', 'server'].forEach(function (dir) {
      if (fs.existsSync(path.join(REPO, dir))) { walk(dir); }
    });
    expect(hits).toEqual([['imports/startup/client/index.js', 1]]);
  });
});

describe('riskProperties stale index drop is quiet on a fresh database (#3)', () => {
  const src = readSourceWithoutComments('imports/server/collections/riskProperties.js');
  const handler = between(src, "dropIndex('riskProperties_autoKey_unique')", 'console.error');

  it('skips NamespaceNotFound (code 26 / "ns not found")', () => {
    expect(handler).toMatch(/error\.code === 26/);
    expect(handler).toMatch(/ns not found/);
  });

  it('still skips IndexNotFound (code 27)', () => {
    expect(handler).toMatch(/error\.code === 27/);
  });
});
