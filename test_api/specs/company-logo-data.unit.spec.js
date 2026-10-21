/* eslint-disable no-undef */
// The company logo is stored as a data URI (`logoBase64`): the settings page shows
// it as a preview and the PDF reports embed it. pdfmake only renders PNG and JPEG,
// so logoDataUri() accepts exactly those two formats, recognised by their file
// signature rather than by a server-supplied Content-Type or the URL's extension,
// and refuses anything large enough to bloat every company document read.
const {logoDataUri, MAX_LOGO_BYTES} = require('../../imports/lib/companies/companyLogo');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function padded(signature, size) {
  const buffer = Buffer.alloc(size);
  signature.copy(buffer, 0);
  return buffer;
}

describe('logoDataUri', () => {
  it('turns a PNG into a PNG data URI', () => {
    expect(logoDataUri(PNG)).toBe('data:image/png;base64,' + PNG.toString('base64'));
  });

  it('turns a JPEG into a JPEG data URI', () => {
    expect(logoDataUri(JPEG)).toBe('data:image/jpeg;base64,' + JPEG.toString('base64'));
  });

  it('accepts a Uint8Array as well as a Buffer', () => {
    expect(logoDataUri(new Uint8Array(PNG))).toBe('data:image/png;base64,' + PNG.toString('base64'));
  });

  it.each([
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00', 'binary')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['an HTML error page', Buffer.from('<!DOCTYPE html><html><body>Not found</body></html>')],
    ['a truncated PNG signature', PNG.subarray(0, 4)],
    ['a truncated JPEG signature', JPEG.subarray(0, 2)],
    ['an empty body', Buffer.alloc(0)]
  ])('refuses %s', (_label, body) => {
    expect(logoDataUri(body)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', PNG.toString('binary')],
    ['an array of bytes', Array.from(PNG)]
  ])('refuses %s', (_label, body) => {
    expect(logoDataUri(body)).toBeNull();
  });

  it('caps the logo at 512 KB', () => {
    expect(MAX_LOGO_BYTES).toBe(512 * 1024);
    expect(logoDataUri(padded(PNG, MAX_LOGO_BYTES))).toMatch(/^data:image\/png;base64,/);
    expect(logoDataUri(padded(PNG, MAX_LOGO_BYTES + 1))).toBeNull();
  });
});
