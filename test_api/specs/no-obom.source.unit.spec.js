/* eslint-disable no-undef */
// The Community Edition has no OBOM. Both halves of the feature were AWS Lambda
// Function URLs (`ts-obom-ingest` / `ts-obom-read`) reached over SigV4 - ingest
// existed nowhere else, so there is nothing a self-hosted installation can point
// at. These source checks keep the client, its methods, its REST routes, its UI
// surfaces and the AWS signing packages from coming back.
//
// Nothing was stored in this app's own collections, so there is no legacy field
// to keep and no migration to guard.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const DELETED_PATHS = [
  'imports/server/obom',
  'imports/startup/server/ts-obom.js',
  'imports/server/rest-api/obom.js',
  'imports/client/ui/common/obom-presence-cell',
  'imports/client/ui/common/obom-document-view',
  'imports/client/ui/module/module-details/module-obom',
  'imports/client/ui/helpers/obom-presence.js',
  'imports/client/stylesheets/common/obom-document.less',
  'test_api/specs/obom.spec.js',
  'awscf/ts-core_addObomAccess.yaml',
  'awscf/params4ObomDEV.json'
];

// Every file that imported, registered or rendered an OBOM surface. `style.less`
// is included because a dangling @import breaks the whole stylesheet build, not
// just the OBOM rules.
const CLEANED_SOURCES = [
  'imports/startup/server/index.js',
  'imports/startup/server/register-restapi.js',
  'imports/client/ui/common/index.js',
  'imports/client/ui/helpers/index.js',
  'imports/client/ui/module/module-details/index.js',
  'imports/client/ui/module/module-list/module-list.js',
  'imports/client/ui/project/project-list.js',
  'imports/client/ui/project/project-settings.js',
  'imports/client/ui/module/module-details/module-detail.js',
  'imports/client/ui/module/module-details/module-dependencies/module-dependencies.js',
  'imports/lib/userExtUtils.js',
  'imports/server/rest-api/apiSchema.js',
  'imports/server/config.js',
  'imports/client/stylesheets/style.less'
];

const CLEANED_TEMPLATES = [
  'imports/client/ui/project/project-settings.html',
  'imports/client/ui/module/module-details/module-detail.html',
  'imports/client/ui/module/module-details/module-dependencies/module-dependencies.html'
];

describe('OBOM is gone', () => {
  it.each(DELETED_PATHS)('%s no longer exists', (relative) => {
    expect(fs.existsSync(path.join(root, relative))).toBe(false);
  });

  // Read raw, not comment-stripped: a comment block documenting removed settings
  // is exactly the kind of leftover that outlives the code it described.
  it.each(CLEANED_SOURCES)('%s does not mention obom', (file) => {
    expect(fs.readFileSync(path.join(root, file), 'utf8')).not.toMatch(/obom/i);
  });

  it.each(CLEANED_TEMPLATES)('%s renders no OBOM surface', (file) => {
    expect(fs.readFileSync(path.join(root, file), 'utf8')).not.toMatch(/obom/i);
  });
});

describe('no OBOM transport left', () => {
  it('package.json has no AWS SDK or SigV4 signing packages', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    expect(deps.filter((name) => name.startsWith('@aws-sdk/'))).toEqual([]);
    expect(deps).not.toEqual(expect.arrayContaining([
      '@aws-crypto/sha256-js',
      '@smithy/signature-v4',
      '@smithy/protocol-http'
    ]));
  });

  // node_modules is excluded, not searched and filtered: the mongodb driver
  // names @aws-sdk/ as an optional peer for its own AWS auth mechanism, which
  // says nothing about this app's source.
  it('no source signs a request with SigV4', () => {
    const grep = require('child_process').spawnSync('grep', [
      '-rl', '--exclude-dir=node_modules',
      '-e', '@aws-sdk/', '-e', '@smithy/', '-e', '@aws-crypto/',
      'imports', 'server', 'client', 'workers', 'packages', 'tools'
    ], {cwd: root, encoding: 'utf8'});
    expect(grep.stdout.trim()).toBe('');
  });
});

describe('the OBOM REST endpoints are withdrawn', () => {
  it('the OpenAPI document declares no OBOM path', () => {
    const spec = fs.readFileSync(path.join(root, 'public/api-v2/openapi.yaml'), 'utf8');
    expect(spec).not.toMatch(/^ {2}\/core\/imports\/scan\/obom:/m);
    expect(spec).not.toMatch(/^ {2}\/core\/imports\/scan\/obom\/json:/m);
    expect(spec).not.toMatch(/^ {2}\/core\/obom:/m);
  });

  it('no route is registered for them', () => {
    expect(readSourceWithoutComments('imports/startup/server/register-restapi.js'))
      .not.toMatch(/rest-api\/obom/);
  });
});
