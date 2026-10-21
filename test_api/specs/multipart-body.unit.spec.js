/* eslint-disable no-undef */
// Multipart bodies for the REST upload routes, read with a size limit.
//
// RestApi.parseFile / parseMultipartFile ran before any route checked the API key
// and buffered the whole upload in memory with no limit: a live check showed the
// server reading all 25 MB of an anonymous request before answering 401.
// readMultipartBody streams the request through busboy with limits and stops at
// the first byte past `maxBytes`. Driven here with the real busboy.
const {PassThrough} = require('stream');
const Busboy = require('busboy');
const {readMultipartBody} = require('../../imports/server/rest-api/multipartBody');

const BOUNDARY = '----specboundary';

function multipartStream(parts) {
  const req = new PassThrough();
  req.headers = {'content-type': `multipart/form-data; boundary=${BOUNDARY}`};
  const pieces = parts.map((part) => {
    if (part.file) {
      return Buffer.concat([
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.file}"\r\n` +
          `Content-Type: ${part.type || 'application/octet-stream'}\r\n\r\n`),
        part.data,
        Buffer.from('\r\n')
      ]);
    }
    return Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`);
  });
  req.end(Buffer.concat([...pieces, Buffer.from(`--${BOUNDARY}--\r\n`)]));
  return req;
}

describe('readMultipartBody', () => {
  it('returns the file content, its metadata and the form fields', async () => {
    const req = multipartStream([
      {name: 'documentType', value: 'userManual'},
      {name: 'file', file: 'sbom.json', type: 'application/json', data: Buffer.from('{"a":1}')}
    ]);
    const body = await readMultipartBody(req, {Busboy, maxBytes: 1024});
    expect(body.documentContent.toString()).toBe('{"a":1}');
    expect(body.filename).toBe('sbom.json');
    expect(body.mimeType).toBe('application/json');
    expect(body.documentType).toBe('userManual');
  });

  it('accepts a file of exactly maxBytes', async () => {
    const req = multipartStream([{name: 'file', file: 'x.bin', data: Buffer.alloc(1024, 1)}]);
    const body = await readMultipartBody(req, {Busboy, maxBytes: 1024});
    expect(body.documentContent.length).toBe(1024);
  });

  it('refuses a file larger than maxBytes with 413', async () => {
    const req = multipartStream([{name: 'file', file: 'x.bin', data: Buffer.alloc(1025, 1)}]);
    await expect(readMultipartBody(req, {Busboy, maxBytes: 1024})).rejects.toMatchObject({status: 413});
  });

  it('refuses a second file instead of concatenating it into the first', async () => {
    const req = multipartStream([
      {name: 'file', file: 'a.bin', data: Buffer.from('aaa')},
      {name: 'file', file: 'b.bin', data: Buffer.from('bbb')}
    ]);
    await expect(readMultipartBody(req, {Busboy, maxBytes: 1024})).rejects.toMatchObject({status: 400});
  });

  it('resolves with no documentContent when the body carries no file', async () => {
    const req = multipartStream([{name: 'note', value: 'hello'}]);
    const body = await readMultipartBody(req, {Busboy, maxBytes: 1024});
    expect(body.documentContent).toBeUndefined();
    expect(body.note).toBe('hello');
  });

  it('rejects a malformed multipart body with 400', async () => {
    const req = new PassThrough();
    req.headers = {'content-type': 'multipart/form-data'};
    req.end('not multipart');
    await expect(readMultipartBody(req, {Busboy, maxBytes: 1024})).rejects.toMatchObject({status: 400});
  });
});
