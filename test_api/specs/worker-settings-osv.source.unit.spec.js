// The analysis worker asks OSV only when the runner hands it TS_OSV_ENABLED === true,
// and it no longer receives the TrustSource vulnerability service settings.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(REPO, relative), 'utf8');
}

function workerSettingsBody() {
  const source = read('imports/server/workerRunner/index.js');
  const start = source.indexOf('function workerSettings()');
  if (start === -1) {
    throw new Error('re-anchor this spec: workerSettings() is gone from imports/server/workerRunner/index.js');
  }
  return source.slice(start, source.indexOf('\n}', start));
}

describe('analysis worker settings for the OSV lookups', () => {
  it('hands the worker the OSV switch as a real boolean', () => {
    expect(workerSettingsBody()).toMatch(/TS_OSV_ENABLED: Config\.TS_OSV_ENABLED === true/);
  });

  it('no longer hands over the vulnerability service settings', () => {
    const body = workerSettingsBody();
    expect(body).toMatch(/MONGO_URL/);
    expect(body).not.toMatch(/TS_VULNERABILITY_API/);
    expect(body).not.toMatch(/TS_API_KEY/);
  });

  it('config reads TS_OSV_ENABLED as on unless it is the literal false', () => {
    expect(read('imports/server/config.js')).toMatch(/TS_OSV_ENABLED: process\.env\.TS_OSV_ENABLED !== 'false'/);
  });
});
