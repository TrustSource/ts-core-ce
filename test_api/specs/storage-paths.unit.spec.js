/* eslint-disable no-undef */
// Local file storage (CE, replaces S3): every stored file is addressed by a
// company, an allow-listed folder and a strictly validated name, and must resolve
// inside the storage root. Stored product URLs are client-writable
// (Products.allow update), so a URL is only ever accepted as the name of one of
// the caller's own files.
const path = require('path');
const {
  NOTICE_FILES_FOLDER, PRODUCT_FILES_FOLDER, MAX_ARCHIVE_FILES,
  resolveStoragePath, productFileExtension, productFileUrl, parseProductFileUrl,
  productFileRef, productFileContentType, withAbsoluteProductFileUrls
} = require('../../imports/server/storage/storagePaths');

const ROOT = path.resolve('/srv/files');
const COMPANY = 'CompanyAAAAAAAAAA';
const OTHER = 'CompanyBBBBBBBBBB';
const UUID_NAME = '0b7e4a1c-2f6d-4b8e-9a3c-5d1e7f9a2b4c.pdf';

describe('resolveStoragePath', () => {
  it('resolves a notice file and a product file inside the root', () => {
    expect(resolveStoragePath(ROOT, COMPANY, NOTICE_FILES_FOLDER, '1726560000000.json'))
      .toBe(path.join(ROOT, COMPANY, 'notice-files', '1726560000000.json'));
    expect(resolveStoragePath(ROOT, COMPANY, PRODUCT_FILES_FOLDER, UUID_NAME))
      .toBe(path.join(ROOT, COMPANY, 'product-files', UUID_NAME));
  });

  it('keeps the company id as stored (no lowercasing)', () => {
    expect(resolveStoragePath(ROOT, 'AbC', NOTICE_FILES_FOLDER, '1.json')).toBe(path.join(ROOT, 'AbC', 'notice-files', '1.json'));
  });

  it.each([
    ['no root', [undefined, COMPANY, NOTICE_FILES_FOLDER, '1.json']],
    ['a company with a slash', [ROOT, 'a/b', NOTICE_FILES_FOLDER, '1.json']],
    ['a traversing company', [ROOT, '..', NOTICE_FILES_FOLDER, '1.json']],
    ['a non-string company', [ROOT, {toString: () => COMPANY}, NOTICE_FILES_FOLDER, '1.json']],
    ['an unknown folder', [ROOT, COMPANY, 'policy', '1.json']],
    ['an inherited folder name', [ROOT, COMPANY, 'constructor', '1.json']],
    ['a notice name that is not digits.json', [ROOT, COMPANY, NOTICE_FILES_FOLDER, 'x.json']],
    ['a traversing name', [ROOT, COMPANY, NOTICE_FILES_FOLDER, '../1.json']],
    ['a product name that is not a uuid', [ROOT, COMPANY, PRODUCT_FILES_FOLDER, 'manual.pdf']],
    ['an uppercase extension', [ROOT, COMPANY, PRODUCT_FILES_FOLDER, UUID_NAME.replace('.pdf', '.PDF')]],
    ['a double extension', [ROOT, COMPANY, PRODUCT_FILES_FOLDER, UUID_NAME + '.html']]
  ])('refuses %s', (label, args) => {
    expect(resolveStoragePath(...args)).toBeNull();
  });
});

describe('productFileExtension', () => {
  it('lowercases and strips a leading dot', () => {
    expect(productFileExtension('PDF')).toBe('pdf');
    expect(productFileExtension('.docx')).toBe('docx');
  });

  it.each([undefined, '', 'p d f', 'toolongextension', '../pdf', 'tar.gz', 42])('refuses %p', (value) => {
    expect(productFileExtension(value)).toBeNull();
  });
});

describe('productFileUrl / parseProductFileUrl', () => {
  it('builds an app-relative URL and parses it back', () => {
    const url = productFileUrl(COMPANY, UUID_NAME);
    expect(url).toBe(`/files/products/${COMPANY}/${UUID_NAME}`);
    expect(parseProductFileUrl(url)).toEqual({companyId: COMPANY, name: UUID_NAME});
  });

  it('accepts an absolute URL on any origin (only company and name count)', () => {
    expect(parseProductFileUrl(`https://ce.example.org/files/products/${COMPANY}/${UUID_NAME}`))
      .toEqual({companyId: COMPANY, name: UUID_NAME});
  });

  it('refuses to build a URL for an invalid name', () => {
    expect(productFileUrl(COMPANY, 'manual.pdf')).toBeNull();
  });

  it.each([
    ['a non-string', {toString: () => `/files/products/${COMPANY}/${UUID_NAME}`}],
    ['another route', `/cdn/storage/${COMPANY}/${UUID_NAME}`],
    ['a nested name', `/files/products/${COMPANY}/sub/${UUID_NAME}`],
    ['encoded traversal', `/files/products/${COMPANY}/%2e%2e%2f${UUID_NAME}`],
    ['a query string', `/files/products/${COMPANY}/${UUID_NAME}?x=1`],
    ['a fragment', `/files/products/${COMPANY}/${UUID_NAME}#x`],
    ['an old S3 URL', `https://s3.eu-central-1.amazonaws.com/bucket/${COMPANY.toLowerCase()}/product-files/${UUID_NAME}`]
  ])('refuses %s', (label, url) => {
    expect(parseProductFileUrl(url)).toBeNull();
  });
});

describe('productFileRef', () => {
  it('returns a storage reference only for the caller\'s company', () => {
    const url = productFileUrl(COMPANY, UUID_NAME);
    expect(productFileRef(url, COMPANY)).toEqual({companyId: COMPANY, folder: PRODUCT_FILES_FOLDER, name: UUID_NAME});
    expect(productFileRef(url, OTHER)).toBeNull();
    expect(productFileRef(url, undefined)).toBeNull();
  });
});

describe('productFileContentType', () => {
  it('maps allow-listed extensions and falls back to octet-stream', () => {
    expect(productFileContentType(UUID_NAME)).toBe('application/pdf');
    expect(productFileContentType(UUID_NAME.replace('.pdf', '.png'))).toBe('image/png');
    expect(productFileContentType(UUID_NAME.replace('.pdf', '.html'))).toBe('application/octet-stream');
  });
});

describe('withAbsoluteProductFileUrls', () => {
  const toAbsolute = (p) => `https://ce.example.org/${p.replace(/^\//, '')}`;

  it('turns relative document and photo URLs into absolute ones without touching the input', () => {
    const product = {
      _id: 'p1',
      documents: {
        userManual: {url: productFileUrl(COMPANY, UUID_NAME), name: 'manual.pdf'},
        photos: [{url: productFileUrl(COMPANY, UUID_NAME.replace('.pdf', '.png')), name: 'a.png'}]
      }
    };
    const out = withAbsoluteProductFileUrls(product, toAbsolute);
    expect(out.documents.userManual.url).toBe(`https://ce.example.org/files/products/${COMPANY}/${UUID_NAME}`);
    expect(out.documents.photos[0].url).toMatch(/^https:\/\/ce\.example\.org\/files\/products\//);
    expect(product.documents.userManual.url).toBe(`/files/products/${COMPANY}/${UUID_NAME}`);
  });

  it('returns products without documents unchanged', () => {
    const product = {_id: 'p1'};
    expect(withAbsoluteProductFileUrls(product, toAbsolute)).toBe(product);
  });

  it('exposes the archive limit', () => {
    expect(MAX_ARCHIVE_FILES).toBe(50);
  });
});
