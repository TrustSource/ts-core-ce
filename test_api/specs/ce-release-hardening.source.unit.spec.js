/* eslint-disable no-undef */
// Access checks added before the first public CE release. Source-level: the
// methods and allow rules run inside Meteor, which Jest does not load.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');

function methodBody(src, name) {
  const start = src.indexOf(`  ${name}: async function`);
  if (start === -1) {
    throw new Error(`${name} not found`);
  }
  const next = src.indexOf('\n  },\n', start);
  return src.slice(start, next);
}

describe('module methods are scoped to the caller\'s company', () => {
  const src = read('imports/server/collections/modules.js');

  it.each(['getModuleAnalysis', 'updateLastAnalysis', 'checkLicense'])('%s checks module access first', (name) => {
    const body = methodBody(src, name);
    expect(body).toMatch(/await requireModuleAccess\(this, moduleId\);/);
    expect(body.indexOf('requireModuleAccess')).toBeLessThan(body.indexOf('Modules.findOneAsync'));
  });

  it('checkLicense also checks the project', () => {
    expect(methodBody(src, 'checkLicense')).toMatch(/await requireProjectAccess\(this, projectId\);/);
  });

  it('requireModuleAccess compares the module company with the caller company', () => {
    const guards = read('imports/server/security/methodGuards.js');
    expect(guards).toMatch(/export async function requireModuleAccess\(invocation, moduleId\)/);
    expect(guards).toMatch(/module\.companyId !== callerCompany/);
  });
});

describe('module allow rule', () => {
  const src = read('imports/server/collections/modules.js');

  it('refuses a client write to companyId or _id', () => {
    expect(src).toMatch(/fieldNames\.indexOf\('companyId'\) > -1 \|\| fieldNames\.indexOf\('_id'\) > -1/);
  });

  it('moves a module only into a project of the same company', () => {
    expect(src).toMatch(/return projectInCompany\(newProjectId, companyId\);/);
    expect(src).toMatch(/Projects\.findOneAsync\(\{_id: projectId, companyId\}/);
  });

  it('lets only members of the module\'s company change followers', () => {
    expect(src).toMatch(/module\.companyId === user\.profile\.companyId/);
  });
});

describe('project allow rule', () => {
  const src = read('imports/server/collections/projects.js');

  it('accepts relatedUsers only together with the general form fields, each validated', () => {
    expect(src).toMatch(/const GENERAL_FORM_FIELDS = \['name', 'description', 'leanix', 'tags', 'confidenceMinScore', 'relatedUsers'\];/);
    expect(src).toMatch(/fieldNames\.every\(\(field\) => GENERAL_FORM_FIELDS\.indexOf\(field\) > -1\)/);
    expect(src).toMatch(/fieldNames\.every\(\(field\) => context\.validateOne\(modifier, field, \{modifier: true\}\)\)/);
  });

  it('lets only members of the project\'s company change followers', () => {
    expect(src).toMatch(/doc\.companyId === user\.profile\.companyId/);
  });
});

describe('SPDX export/import records', () => {
  it.each(['SPDXExports', 'SPDXImports'])('%s denies every client write', (name) => {
    const src = read(`imports/server/collections/${name}.js`);
    expect(src).not.toMatch(new RegExp(`${name}\\.allow\\(`));
    expect(src).toMatch(new RegExp(`${name}\\.deny\\(\\{\\s*insert: \\(\\) => true,\\s*update: \\(\\) => true,\\s*remove: \\(\\) => true\\s*\\}\\)`));
  });
});

describe('TFS calls', () => {
  const src = read('imports/startup/server/tfs.js');

  it('resolve and check the account URL before every request', () => {
    expect(src).toMatch(/await assertSafeEgressUrl\(collectionUrl\(account\)\);/);
    expect(src).not.toMatch(/return tfs\(\{account, token\}\)\.getWorkItems/);
    expect(src.match(/\(await tfsClient\(\{account, token\}\)\)\.getWorkItems\(\)/g)).toHaveLength(7);
  });
});

describe('resendEnrollmentEmail', () => {
  const src = read('imports/startup/server/accounts.js');
  const body = methodBody(src, 'resendEnrollmentEmail');

  it('requires an account admin for client calls', () => {
    expect(body).toMatch(/Roles\.userIsInRole\(caller, 'account_admin', callerCompanyId\)/);
  });

  it('only reaches users of the admin\'s company', () => {
    expect(body).toMatch(/Roles\.getRolesForUserAsync\(target\._id, \{scope: callerCompanyId\}\)/);
    expect(body.indexOf('getRolesForUserAsync')).toBeLessThan(body.indexOf('Accounts.sendEnrollmentEmail'));
  });
});

describe('signature verification', () => {
  it('accepts HMAC signatures only', () => {
    const src = read('imports/lib/models/signature/index.js');
    expect(src).not.toMatch(/objectHash|LEGACY_ALGORITHM|MD5\(/);
  });
});

describe('catalog allow rules', () => {
  it.each(['components', 'cotsComponents', 'infrastructureComponents'])(
    '%s compares the plain document, not the transformed model', (name) => {
      const src = read(`imports/server/collections/${name}.js`);
      expect(src).toMatch(/fetch: \['key'\],[\s\S]{0,250}transform: null/);
    });
});

describe('hosted-service material', () => {
  it('ships no hosted contract supplement or component-manager policy gate', () => {
    ['public/NV2304_CompMgrRole.pdf', 'public/NV2304_CompMgrRole_En.pdf',
      'imports/client/ui/reports/report-critical-components/report-critical-components-notification.js'
    ].forEach((file) => expect(fs.existsSync(path.join(REPO, file))).toBe(false));
    expect(read('imports/server/collections/policy.js')).not.toMatch(/getLastComponentManagerPolicyUpdates|NV2304/);
  });

  it('ships no hosted-database migration scripts', () => {
    expect(fs.existsSync(path.join(REPO, 'tests/mongo-updates'))).toBe(false);
  });
});

describe('hosted-service tooling', () => {
  it('ships no load-test or one-off data-repair tools', () => {
    ['tools/perf', 'tools/data'].forEach((dir) => expect(fs.existsSync(path.join(REPO, dir))).toBe(false));
  });
});
