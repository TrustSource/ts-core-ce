/* eslint-disable no-undef */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('release notes runner', () => {
  const runner = live('imports/startup/server/releaseNotes.js');

  it('inserts only the planned documents and never updates or removes', () => {
    expect(runner).toMatch(/releaseNotesToInsert\(/);
    expect(runner).toMatch(/Updates\.insertAsync\(/);
    expect(runner).not.toMatch(/Updates\.(update|upsert|remove)(Async)?\(/);
  });

  it('logs a failure without blocking startup', () => {
    expect(runner).toMatch(/try \{[\s\S]*\} catch \(e\) \{[\s\S]*console\.error/);
  });

  it('is registered in the server startup index', () => {
    expect(live('imports/startup/server/index.js')).toMatch(/import '\.\/releaseNotes';/);
  });
});
