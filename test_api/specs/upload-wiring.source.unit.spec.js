/* eslint-disable no-undef */
// Wiring for the upload hardening; the decisions themselves are covered by
// multipart-body.unit.spec.js and upload-guards.unit.spec.js.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

// Comment-blind assertions would happily pass on commented-out code.
function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n}\n', start));
}

describe('REST multipart parsers', () => {
  const restApi = read('imports/server/rest-api/RestApi.js');

  it('read the body through readMultipartBody with the configured limit', () => {
    expect(restApi).toMatch(/import\s*\{[^}]*\breadMultipartBody\b[^}]*\}\s*from\s*'\.\/multipartBody'/);
    expect(restApi).toMatch(/import\s*\{[^}]*\buploadMaxBytes\b[^}]*\}\s*from\s*'\/imports\/server\/security\/uploadGuards'/);
    for (const name of ['function parseFile', 'function parseMultipartFile']) {
      const body = functionBody(restApi, name);
      expect(body).toMatch(/readMultipartBody\(\s*req\s*,\s*\{[^}]*maxBytes/);
      expect(body).not.toMatch(/Busboy\(\{/);
    }
  });

  it('parseFile refuses a request without an API key before reading it', () => {
    const body = functionBody(restApi, 'function parseFile');
    const keyCheck = body.search(/headers\['x-api-key'\]/);
    const read = body.search(/readMultipartBody\(/);
    expect(keyCheck).toBeGreaterThan(-1);
    expect(keyCheck).toBeLessThan(read);
    expect(body).toMatch(/writeHead\(401\)/);
  });
});

describe('ostrio:files collections', () => {
  it.each(['moduleImports', 'SPDXFiles', 'policyFiles'])('%s requires a logged-in uploader and serves attachments', (name) => {
    const source = read(`imports/lib/collections/${name}.js`);
    const start = source.indexOf('onBeforeUpload(');
    const hook = source.slice(start, source.indexOf('\n  }', start));
    expect(hook).toMatch(/if\s*\(\s*!this\.userId\s*\)/);
    expect(hook.search(/!this\.userId/)).toBeLessThan(hook.search(/file\.size/));
    expect(source).toMatch(/import\s*\{[^}]*\battachmentResponseHeaders\b[^}]*\}\s*from\s*'\/imports\/lib\/files\/downloadHeaders'/);
    expect(source).toMatch(/responseHeaders:\s*attachmentResponseHeaders/);
  });
});

describe('ostrio HTTP upload route guard', () => {
  it('is installed on the raw connect handlers at startup', () => {
    const guard = read('imports/startup/server/files-upload-guard.js');
    expect(guard).toMatch(/WebApp\.rawConnectHandlers\.use\(/);
    expect(guard).toMatch(/isFilesHttpUploadRequest\(\s*req\s*\)/);
    expect(guard).toMatch(/writeHead\(403/);
    expect(read('imports/startup/server/index.js')).toMatch(/import\s+'\.\/files-upload-guard';/);
  });
});
