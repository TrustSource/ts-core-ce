/* eslint-disable no-undef */
// GET /spdx/:documentName-:uuid serves a stored SPDX export from local storage. A file that is
// missing on disk (an expected state now that files live on a volume) must answer 404: a
// ReadStream opened on a missing path emits an 'error' nobody listened for, which took the
// whole server process down. A client that aborts mid-download must not leave the file open.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {PassThrough, pipeline} = require('stream');
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');
const {serveStoredFile} = require('../../imports/lib/files/serveStoredFile');

function response() {
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (chunk) => chunks.push(chunk));
  out.writeHead = function (status, headers) { this.status = status; this.headers = headers || {}; };
  out.body = () => Buffer.concat(chunks).toString('utf8');
  return out;
}

function finished(res) {
  return new Promise((resolve) => res.on('finish', resolve));
}

describe('serveStoredFile', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spdx-route-'));
  });

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true});
  });

  it('streams an existing file with the given headers', async () => {
    const file = path.join(dir, 'export.rdf');
    fs.writeFileSync(file, '<rdf/>');
    const res = response();
    const done = finished(res);
    await serveStoredFile({fs, pipeline, response: res, filePath: file,
      headers: {'Content-Type': 'application/rdf+xml'}, notFoundMessage: 'SPDX file not found'});
    await done;
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/rdf+xml');
    expect(res.body()).toBe('<rdf/>');
  });

  it.each([
    ['a missing file', (root) => path.join(root, 'gone.rdf')],
    ['a directory', (root) => root]
  ])('answers 404 without opening a stream for %s', async (label, target) => {
    const openSpy = jest.fn(fs.createReadStream);
    const fakeFs = {promises: fs.promises, createReadStream: openSpy};
    const res = response();
    await expect(serveStoredFile({fs: fakeFs, pipeline, response: res, filePath: target(dir),
      headers: {}, notFoundMessage: 'SPDX file not found'})).resolves.toBe(false);
    expect(res.status).toBe(404);
    expect(res.body()).toBe('SPDX file not found');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('logs a stat failure other than a missing file and still answers 404', async () => {
    const error = Object.assign(new Error('permission denied'), {code: 'EACCES'});
    const fakeFs = {promises: {stat: async () => { throw error; }}, createReadStream: jest.fn()};
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = response();
      await serveStoredFile({fs: fakeFs, pipeline, response: res, filePath: '/x', headers: {}});
      expect(res.status).toBe(404);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('does not crash when the file disappears between stat and read', async () => {
    const file = path.join(dir, 'export.rdf');
    fs.writeFileSync(file, '<rdf/>');
    const fakeFs = {
      promises: fs.promises,
      createReadStream: () => fs.createReadStream(path.join(dir, 'vanished.rdf'))
    };
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = response();
      const closed = new Promise((resolve) => res.on('close', resolve));
      await serveStoredFile({fs: fakeFs, pipeline, response: res, filePath: file, headers: {}});
      await closed;
      expect(res.destroyed).toBe(true);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('destroys the source stream when the response is aborted mid-download', async () => {
    const file = path.join(dir, 'export.rdf');
    fs.writeFileSync(file, '<rdf/>');
    const source = new PassThrough();
    const fakeFs = {promises: fs.promises, createReadStream: () => source};
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = response();
      await serveStoredFile({fs: fakeFs, pipeline, response: res, filePath: file, headers: {}});
      source.write('partial-chunk');
      expect(source.destroyed).toBe(false);
      res.destroy();
      await new Promise((resolve) => setImmediate(resolve));
      expect(source.destroyed).toBe(true);
      // A client abort is not a read failure worth logging.
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('the /spdx route uses it', () => {
  const router = readSourceWithoutComments('imports/lib/router.js');
  const start = router.indexOf('Router.route(\'/spdx/');
  const block = router.slice(start, router.indexOf('\n});', start));

  it('imports the shared helper and hands it node fs and stream.pipeline from the server action', () => {
    expect(start).toBeGreaterThan(-1);
    expect(router).toMatch(/import\s*\{\s*serveStoredFile\s*\}\s*from\s*'\/imports\/lib\/files\/serveStoredFile'/);
    expect(block).toMatch(/require\('fs'\)/);
    expect(block).toMatch(/require\('stream'\)/);
    expect(block).toMatch(/await serveStoredFile\(\{/);
  });

  it('no longer pipes a bare read stream into the response', () => {
    expect(block).not.toMatch(/createReadStream\([^)]*\)\.pipe\(/);
  });

  it('keeps node core requires out of the top of the shared router', () => {
    const topLevel = router.slice(0, router.indexOf('Router.configure('));
    expect(topLevel).not.toMatch(/from\s+'(fs|stream|path)'|require\('(fs|stream|path)'\)/);
    expect(router).not.toMatch(/from\s+'\/imports\/server\//);
  });
});
