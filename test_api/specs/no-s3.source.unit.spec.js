/* eslint-disable no-undef */
// The Community Edition has no S3: files stay on the local (shared) volume. These
// source checks keep the S3 client, its settings and the ostrio S3 hooks from coming
// back.
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const COLLECTIONS = [
  'imports/lib/collections/SPDXFiles.js',
  'imports/lib/collections/moduleImports.js',
  'imports/lib/collections/policyFiles.js'
];

describe('ostrio:files collections keep files on local storage', () => {
  it.each(COLLECTIONS)('%s has no S3 client or S3 hooks', (file) => {
    const source = readSourceWithoutComments(file);
    expect(source).not.toMatch(/client-s3|s3path|S3_BUCKET|putObject|getObject|deleteObject/);
    expect(source).not.toMatch(/onAfterUpload|interceptDownload/);
    expect(source).toMatch(/storagePath:\s*uploadPath/);
  });

  it('reads module import files from disk only', () => {
    const source = readSourceWithoutComments('imports/lib/collections/moduleImports.js');
    expect(source).toMatch(/export async function readImportFileContent\(/);
    expect(source).toMatch(/fs\.promises\.readFile\(vRef\.path, 'utf8'\)/);
  });

  it('the SPDX import never fetches its own files over HTTP', () => {
    const source = readSourceWithoutComments('imports/lib/interactors/SPDXImports/import.js');
    expect(source).not.toMatch(/httpCall|httpFetch/);
  });
});

describe('no S3 settings or dependencies', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../..');

  it('package.json has no S3 SDK', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies || {})).not.toEqual(expect.arrayContaining(['@aws-sdk/client-s3']));
    expect(Object.keys(pkg.dependencies || {})).not.toEqual(expect.arrayContaining(['@aws-sdk/s3-request-presigner']));
  });

  it('server config has no S3 bucket settings', () => {
    expect(readSourceWithoutComments('imports/server/config.js')).not.toMatch(/S3_BUCKET/);
  });

  it('the image declares the storage volume', () => {
    const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/^VOLUME \/app\.storage\/files$/m);
    expect(dockerfile).not.toMatch(/awscli|s3cmd/);
  });
});
