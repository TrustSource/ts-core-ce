/* eslint-disable no-undef */
// Upload guards that are pure decisions.
//
// - The ostrio:files HTTP upload route (POST /cdn/storage/<collection>/__upload)
//   accepted anonymous uploads: a live check wrote a file with userId null. The
//   app uploads over DDP only (no FilesCollection insert sets transport: 'http'),
//   so the route is refused outright, before ostrio reads the body.
// - The REST multipart size limit comes from TS_UPLOAD_MAX_MB.
// - Stored files are downloaded as attachments with nosniff: their Content-Type is
//   whatever the uploader declared, and served inline an HTML "import" would run
//   on the app's origin.
const {
  isFilesHttpUploadRequest,
  uploadMaxBytes,
  DEFAULT_UPLOAD_MAX_MB
} = require('../../imports/server/security/uploadGuards');
const {attachmentResponseHeaders} = require('../../imports/lib/files/downloadHeaders');

describe('isFilesHttpUploadRequest', () => {
  it.each([
    ['POST', '/cdn/storage/ModuleImports/__upload'],
    ['POST', '/cdn/storage/policyFiles/__upload?x=1'],
    ['post', '/cdn/storage/SPDXFiles/__upload']
  ])('matches %s %s', (method, url) => {
    expect(isFilesHttpUploadRequest({method, url})).toBe(true);
  });

  it.each([
    ['GET', '/cdn/storage/ModuleImports/abc/original/abc.json'],
    ['POST', '/api/v2/core/imports/scan/cyclonedx/json'],
    ['POST', '/cdn/storage/ModuleImports/__uploadx'],
    ['POST', '/cdn/storage/__upload'],
    ['OPTIONS', '/cdn/storage/ModuleImports/__upload']
  ])('leaves %s %s alone', (method, url) => {
    expect(isFilesHttpUploadRequest({method, url})).toBe(false);
  });
});

describe('uploadMaxBytes', () => {
  it('defaults to DEFAULT_UPLOAD_MAX_MB', () => {
    expect(DEFAULT_UPLOAD_MAX_MB).toBe(50);
    expect(uploadMaxBytes({})).toBe(50 * 1024 * 1024);
  });

  it('reads a positive TS_UPLOAD_MAX_MB', () => {
    expect(uploadMaxBytes({TS_UPLOAD_MAX_MB: '120'})).toBe(120 * 1024 * 1024);
  });

  it.each(['0', '-5', 'abc', '', '1e999'])('falls back to the default for %p', (value) => {
    expect(uploadMaxBytes({TS_UPLOAD_MAX_MB: value})).toBe(50 * 1024 * 1024);
  });
});

describe('attachmentResponseHeaders', () => {
  const fileRef = {name: 'report "final".html'};
  const versionRef = {type: 'text/html', size: 2048, name: 'report "final".html'};

  it('forces a download and forbids content sniffing', () => {
    const headers = attachmentResponseHeaders('200', fileRef, versionRef);
    expect(headers['Content-Disposition']).toMatch(/^attachment; /);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Type']).toBe('text/html');
  });

  it('quotes the file name safely', () => {
    const disposition = attachmentResponseHeaders('200', fileRef, versionRef)['Content-Disposition'];
    expect(disposition).not.toContain('"final"');
    expect(disposition).toContain("filename*=UTF-8''report%20%22final%22.html");
  });

  it('keeps ostrio\'s range and error headers', () => {
    expect(attachmentResponseHeaders('206', fileRef, versionRef)).toMatchObject({Pragma: 'private', 'Transfer-Encoding': 'chunked'});
    expect(attachmentResponseHeaders('416', fileRef, versionRef)['Content-Range']).toBe('bytes */2048');
    expect(attachmentResponseHeaders('400', fileRef, versionRef)['Cache-Control']).toBe('no-cache');
    expect(attachmentResponseHeaders('200', fileRef, {size: 1})['Content-Type']).toBe('application/octet-stream');
  });
});
