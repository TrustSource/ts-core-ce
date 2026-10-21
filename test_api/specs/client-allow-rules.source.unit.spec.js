/* eslint-disable no-undef */
// Client write rules (Collection.allow / Collection.deny) before the public CE release.
//
// One passing allow rule is enough for a client insert/update/remove over DDP, so every
// allow rule is a write path that skips the server methods and their checks. Collections
// the browser never writes directly deny every client write; the few the UI still writes
// (component catalog edit pages, COTS create, policy create, legal template create) check
// the caller, the role and the fields the write may touch.
const fs = require('fs');
const path = require('path');
const _ = require('underscore');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const REPO = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function listJs(dir) {
  const out = [];
  fs.readdirSync(dir, {withFileTypes: true}).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJs(full));
    } else if (/\.js$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) {
      out.push(full);
    }
  });
  return out;
}

// Client code plus every shared module it imports directly: interactors such as
// csaf/create.js and testImports/create.js run in the browser and write from there.
function clientReachableFiles() {
  const client = listJs(path.join(REPO, 'imports/client')).concat(listJs(path.join(REPO, 'client')));
  const shared = new Set();
  client.forEach((file) => {
    const src = fs.readFileSync(file, 'utf8');
    (src.match(/from '\/imports\/lib\/[^']+'/g) || []).forEach((spec) => {
      const target = path.join(REPO, spec.slice(7, -1));
      [target + '.js', path.join(target, 'index.js'), target].forEach((candidate) => {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          shared.add(candidate);
        }
      });
    });
  });
  return client.concat(Array.from(shared));
}

// file -> the collection expression whose client writes are all denied.
const DENY_ALL = {
  'imports/server/collections/aiProperties.js': 'AiProperties',
  'imports/server/collections/analysis.js': 'ModuleAnalysis',
  'imports/server/collections/approvalReports.js': 'ApprovalReports',
  'imports/server/collections/approves.js': 'Approves',
  'imports/server/collections/capabilities.js': 'Capabilities',
  'imports/server/collections/componentModifications.js': 'ComponentModifications',
  'imports/server/collections/constraints.js': 'Constraints',
  'imports/server/collections/cryptoProperties.js': 'CryptoProperties',
  'imports/server/collections/cweMappings.js': 'CweMappings',
  'imports/server/collections/loginsHistory.js': 'LoginsHistory',
  'imports/server/collections/manualVulnerabilities.js': 'ManualVulnerabilities',
  'imports/server/collections/messages.js': 'Messages',
  'imports/server/collections/noticeFiles.js': 'NoticeFiles',
  'imports/server/collections/products.js': 'Products',
  'imports/server/collections/qualityProperties.js': 'QualityProperties',
  'imports/server/collections/requirementsHistory.js': 'RequirementsHistory',
  'imports/server/collections/riskProperties.js': 'RiskProperties',
  'imports/server/collections/roles.js': 'Meteor.roles',
  'imports/server/collections/rules.js': 'Rules',
  'imports/server/collections/sbom.js': 'SBOMs',
  'imports/server/collections/sbomFiles.js': 'SbomFiles',
  'imports/server/collections/scans.js': 'Scans',
  'imports/server/collections/tags.js': 'Tags',
  'imports/server/collections/tasks.js': 'Tasks',
  'imports/server/collections/testTools.js': 'TestTools'
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('collections the browser never writes deny every client write', () => {
  Object.keys(DENY_ALL).forEach((file) => {
    const name = DENY_ALL[file];
    it(`${name} (${path.basename(file)}) has no allow rule and a deny-all rule`, () => {
      const src = stripComments(read(file));
      expect(src).not.toMatch(new RegExp(escape(name) + '\\.allow\\('));
      expect(src).toMatch(new RegExp(escape(name) +
        '\\.deny\\(\\{\\s*insert: \\(\\) => true,\\s*update: \\(\\) => true,\\s*remove: \\(\\) => true\\s*\\}\\)'));
    });
  });

  it('no client code writes any of them directly', () => {
    const names = Object.values(DENY_ALL).filter((n) => n !== 'Meteor.roles');
    const pattern = new RegExp('\\b(' + names.join('|') + ')\\.(insert|update|remove|upsert)(Async)?\\(');
    const hits = [];
    clientReachableFiles().forEach((file) => {
      if (pattern.test(stripComments(fs.readFileSync(file, 'utf8')))) {
        hits.push(path.relative(REPO, file));
      }
    });
    expect(hits).toEqual([]);
  });

  it('the global roles collection is no longer client-insertable', () => {
    const src = stripComments(read('imports/server/collections/roles.js'));
    expect(src).not.toMatch(/existingRole/);
  });
});

// ComponentLogs keeps its allow rule whose three arms all return false (pinned by
// internal-methods-guard.integration.unit.spec.js); that denies every client write too.
describe('ComponentLogs', () => {
  it('every allow arm returns false', () => {
    const src = stripComments(read('imports/server/collections/componentLogs.js'));
    const block = src.match(/ComponentLogs\.allow\(\{([\s\S]*?)\n\}\);/);
    expect(block).not.toBeNull();
    ['insert', 'update', 'remove'].forEach((arm) => {
      expect(block[1]).toMatch(new RegExp(arm + ': function \\(\\) \\{\\s*return false\\s*\\}'));
    });
  });
});

describe('the remaining allow rules are a known, reviewed set', () => {
  it('every .allow( under imports/server belongs to a collection the UI writes', () => {
    const found = [];
    listJs(path.join(REPO, 'imports/server')).forEach((file) => {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      (src.match(/[\w.]+\.allow\(/g) || []).forEach((m) => found.push(m.replace('.allow(', '')));
    });
    expect(found.sort()).toEqual([
      'COTSComponents', 'CSAF', 'ComponentLogs', 'Components', 'InfrastructureComponents', 'LegalSettingsTemplates',
      'Modules', 'Policy', 'Projects', 'Tests', 'Webhooks'
    ]);
  });
});

describe('Meteor.users', () => {
  const src = stripComments(read('imports/server/collections/users.js'));

  it('has no app-level allow rule left', () => {
    expect(src).not.toMatch(/Meteor\.users\.allow\(/);
    expect(src).not.toMatch(/function managesUser|function isModificationAllowed|function isLastManager/);
  });

  it('denies inserts, removes and every update outside the own profile', () => {
    expect(src).toMatch(/Meteor\.users\.deny\(\{\s*insert: \(\) => true,\s*update: \(userId, doc, fieldNames\) => !\(fieldNames\.length === 1 && fieldNames\[0\] === 'profile'\),\s*remove: \(\) => true,\s*fetch: \['_id'\]\s*\}\)/);
  });
});

// --- behaviour of the rules that stay ------------------------------------------------------

class MeteorError extends Error {
  constructor(error, reason) {
    super(reason);
    this.error = error;
    this.reason = reason;
  }
}

const COMPANY = 'company-own';
const USERS = {
  manager: {_id: 'manager', profile: {companyId: COMPANY}},
  developer: {_id: 'developer', profile: {companyId: COMPANY}},
  'no-profile': {_id: 'no-profile'}
};
const GRANTS = {manager: ['company_component_manager', 'compliance_manager']};

function rolesStub() {
  return {
    Roles: {
      userIsInRole: async function (userId, roles) {
        const id = userId && userId._id ? userId._id : userId;
        const wanted = [].concat(roles);
        return (GRANTS[id] || []).some((role) => wanted.indexOf(role) !== -1);
      }
    }
  };
}

function collectionStub(existing) {
  const captured = {};
  return {
    captured,
    allow: function (rules) { Object.assign(captured, rules); },
    after: {insert: function () {}, update: function () {}},
    find: function () { return {fetchAsync: async function () { return []; }}; },
    findOneAsync: async function (selector) {
      return (existing || []).find((doc) => !selector || !selector.key || doc.key === selector.key);
    },
    updateAsync: async function () { return 1; }
  };
}

function meteorStub() {
  return {
    Meteor: {
      isServer: true,
      Error: MeteorError,
      methods: function () {},
      publish: function () {},
      startup: function () {},
      users: {findOneAsync: async function (id) { return USERS[id]; }},
      userAsync: async function () { return undefined; },
      callAsync: async function () {}
    }
  };
}

const QOS = loadMeteorModule('imports/lib/component/QOS.js', {'underscore': _}).default;

function commonDeps() {
  return {
    'meteor/meteor': meteorStub(),
    'meteor/alanning:roles': rolesStub(),
    'underscore': _,
    '/imports/lib/component/QOS': {default: QOS},
    '/imports/lib/collections/cves': {default: collectionStub()},
    '/imports/server/ServerUtils': {default: {makeRawCollection: function () { return {}; }}},
    '/imports/lib/mongoId': {idSelector: function (id) { return {_id: id}; }}
  };
}

function loadComponents() {
  const collection = collectionStub();
  loadMeteorModule('imports/server/collections/components.js', Object.assign(commonDeps(), {
    '/imports/lib/component/criticalPackageFacets': {packageTypeFacetQuery: function () { return null; }},
    'meteor/meteorhacks:search-source': {SearchSource: {defineSource: function () {}}},
    '/imports/lib/collections/components': {default: collection},
    '/imports/lib/security/searchRegex': require('../../imports/lib/security/searchRegex'),
    '/imports/server/rest-api/RestApi.js': {default: {}}
  }));
  return collection.captured;
}

function loadCots(existing) {
  const collection = collectionStub(existing);
  loadMeteorModule('imports/server/collections/cotsComponents.js', Object.assign(commonDeps(), {
    '/imports/lib/collections/cotsComponents': {default: collection}
  }));
  return collection.captured;
}

function loadInfrastructure() {
  const collection = collectionStub();
  loadMeteorModule('imports/server/collections/infrastructureComponents.js', Object.assign(commonDeps(), {
    '/imports/lib/collections/infrastructureComponents': {default: collection},
    '/imports/lib/collections/cotsComponents': {default: collectionStub()}
  }));
  return collection.captured;
}

const DOC = {_id: 'c1', key: 'npm:lodash', name: 'lodash'};
const TERMS = {$set: {'commercialTerms.RS': 'yes'}};

describe.each([
  ['Components', loadComponents],
  ['COTSComponents', () => loadCots()],
  ['InfrastructureComponents', loadInfrastructure]
])('%s update rule (global catalog)', (label, load) => {
  const rules = load();

  it('has no remove arm', () => {
    expect(rules.remove).toBeUndefined();
  });

  it('lets a company_component_manager change commercial terms', async () => {
    await expect(rules.update('manager', DOC, ['commercialTerms'], TERMS)).resolves.toBe(true);
  });

  it('accepts the edit page\'s full $set when the key stays the same', async () => {
    const modifier = {$set: {key: DOC.key, name: 'lodash', description: 'x'}};
    await expect(rules.update('manager', DOC, ['key', 'name', 'description'], modifier)).resolves.toBe(true);
  });

  it('refuses a caller without the role, without a profile, or not logged in', async () => {
    await expect(rules.update('developer', DOC, ['commercialTerms'], TERMS)).resolves.toBe(false);
    await expect(rules.update('no-profile', DOC, ['commercialTerms'], TERMS)).resolves.toBe(false);
    await expect(rules.update('unknown', DOC, ['commercialTerms'], TERMS)).resolves.toBe(false);
    await expect(rules.update(null, DOC, ['commercialTerms'], TERMS)).resolves.toBe(false);
  });

  it('refuses a change of the component key or _id', async () => {
    await expect(rules.update('manager', DOC, ['key'], {$set: {key: 'npm:other'}})).resolves.toBe(false);
    await expect(rules.update('manager', DOC, ['key'], {$unset: {key: ''}})).resolves.toBe(false);
    await expect(rules.update('manager', DOC, ['key'], {$rename: {key: 'oldKey'}})).resolves.toBe(false);
    await expect(rules.update('manager', DOC, ['_id'], {$set: {_id: 'x'}})).resolves.toBe(false);
  });
});

// The three catalog files each carry their own copy of the two helpers: they are loaded
// in specs with a fixed set of import stubs, so a shared module would be one more import
// for every one of those specs. The copies must stay identical.
describe('catalog rule helpers stay identical across the three catalog collections', () => {
  const files = ['components', 'cotsComponents', 'infrastructureComponents']
    .map((name) => read(`imports/server/collections/${name}.js`));

  it.each(['async function isComponentManager(userId) {', 'function keepsIdentity(doc, fieldNames, modifier) {'])(
    '%s', (signature) => {
      const bodies = files.map((src) => {
        const start = src.indexOf(signature);
        expect(start).toBeGreaterThan(-1);
        return src.slice(start, src.indexOf('\n}\n', start));
      });
      expect(bodies[1]).toBe(bodies[0]);
      expect(bodies[2]).toBe(bodies[0]);
    });
});

describe('Components insert', () => {
  it('has no client insert: Components.Create is the create path', () => {
    expect(loadComponents().insert).toBeUndefined();
  });
});

describe('InfrastructureComponents insert', () => {
  it('has no client insert: InfrastructureComponents.Create is the create path', () => {
    expect(loadInfrastructure().insert).toBeUndefined();
  });
});

describe('COTSComponents insert (cots-management create modal)', () => {
  const doc = () => ({name: 'Acme Suite', key: 'im:acme-suite', versions: [{version: '1.0'}]});

  it('lets a company_component_manager create a component', async () => {
    await expect(loadCots().insert('manager', doc())).resolves.toBe(true);
  });

  it('refuses a caller without the role or not logged in', async () => {
    await expect(loadCots().insert('developer', doc())).resolves.toBe(false);
    await expect(loadCots().insert(null, doc())).resolves.toBe(false);
  });

  it('refuses a document without a string key', async () => {
    await expect(loadCots().insert('manager', Object.assign(doc(), {key: {$gt: ''}}))).resolves.toBe(false);
    await expect(loadCots().insert('manager', Object.assign(doc(), {key: ''}))).resolves.toBe(false);
  });

  it('refuses a key that already exists', async () => {
    const rules = loadCots([{_id: 'old', key: 'im:acme-suite'}]);
    await expect(rules.insert('manager', doc())).resolves.toBe(false);
  });
});

describe('Policy allow rule', () => {
  const allowRules = {};
  const COMPLIANCE = {_id: 'u1', profile: {companyId: 'c1'}};
  loadMeteorModule('imports/server/collections/policy.js', {
    'meteor/meteor': {Meteor: {
      publish: function () {},
      methods: function () {},
      startup: function () {},
      Error: MeteorError,
      users: {findOneAsync: async function (id) { return id === 'u1' ? COMPLIANCE : undefined; }},
      userAsync: async function () { return COMPLIANCE; },
      callAsync: async function () {}
    }},
    'meteor/alanning:roles': {Roles: {userIsInRole: async function () { return true; }}},
    'meteor/momentjs:moment': {moment: function () { return {}; }},
    'underscore': _,
    '/imports/lib/collections/policy': {
      allow: function (rules) { Object.assign(allowRules, rules); },
      findOneAsync: async function () { return null; },
      find: function () { return {fetchAsync: async function () { return []; }}; }
    },
    '/imports/lib/collections/policyFiles': {collection: {findOneAsync: async function () { return null; }}},
    '/imports/server/ServerUtils': {},
    '/imports/lib/security/sanitizeQuery': loadMeteorModule('imports/lib/security/sanitizeQuery.js', {})
  }, {allowNoExports: true});

  const notified = {$set: {notified: true}};

  it('has no remove arm (policies are removed through a method)', () => {
    expect(allowRules.remove).toBeUndefined();
  });

  it('refuses a "notified" flag write from a caller outside the policy\'s company', async () => {
    await expect(allowRules.update('u1', {companyId: 'OTHER'}, ['notified'], notified)).resolves.toBe(false);
    await expect(allowRules.update(null, {companyId: 'c1'}, ['notified'], notified)).resolves.toBe(false);
    await expect(allowRules.update('stranger', {companyId: 'c1'}, ['notified'], notified)).resolves.toBe(false);
  });

  it('still accepts the "notified" flag write from a member of the policy\'s company', async () => {
    await expect(allowRules.update('u1', {companyId: 'c1'}, ['notified'], notified)).resolves.toBe(true);
  });

  it('refuses moving a policy to another company', async () => {
    await expect(allowRules.update('u1', {companyId: 'c1'}, ['companyId'], {$set: {companyId: 'OTHER'}}))
      .resolves.toBe(false);
  });

  it('refuses an insert from a caller that is not logged in', async () => {
    await expect(allowRules.insert(null, {companyId: 'c1', file: 'f1'})).resolves.toBe(false);
  });
});

describe('Webhooks allow rule', () => {
  const captured = {};
  loadMeteorModule('imports/server/collections/webhooks.js', {
    'meteor/meteor': {Meteor: {
      publish: function () {},
      startup: function () {},
      users: {findOneAsync: async function (id) { return id === 'u1' ? {_id: 'u1', profile: {companyId: 'c1'}} : undefined; }}
    }},
    'meteor/alanning:roles': {Roles: {userIsInRole: async function () { return true; }}},
    '/imports/lib/collections/webhooks': {
      allow: function (rules) { Object.assign(captured, rules); },
      find: function () { return {}; }
    },
    '/imports/server/ServerUtils': {default: {makeRawCollection: function () { return {}; }}},
    '/imports/lib/security/ssrfGuard': require('../../imports/lib/security/ssrfGuard'),
    '/imports/lib/company/webhookAccess': {
      WEBHOOK_ADMIN_ROLES: ['account_admin', 'manager', 'compliance_manager'],
      projectBelongsToCompany: async function () { return true; }
    }
  }, {allowNoExports: true});

  it('has no update or remove arm (Webhook.Remove is the remove path)', () => {
    expect(captured.update).toBeUndefined();
    expect(captured.remove).toBeUndefined();
  });

  it('refuses an unknown or logged-out caller instead of throwing', async () => {
    const row = {companyId: 'c1', name: 'x', type: 'webhook', url: 'https://hooks.example.com/x'};
    await expect(captured.insert('ghost', row)).resolves.toBe(false);
    await expect(captured.insert(null, row)).resolves.toBe(false);
  });
});

describe('CSAF insert (csaf-import-modal runs csaf/create.js in the browser)', () => {
  const COMPANIES = {c1: {_id: 'c1', providerId: 'prov-c1'}, c2: {_id: 'c2'}};
  const MEMBERS = {
    writer: {_id: 'writer', profile: {companyId: 'c1'}},
    viewer: {_id: 'viewer', profile: {companyId: 'c1'}},
    plain: {_id: 'plain', profile: {companyId: 'c2'}}
  };
  const WRITERS = ['writer', 'plain'];
  const captured = {};
  loadMeteorModule('imports/server/collections/csaf.js', {
    'meteor/meteor': {Meteor: {
      publish: function () {},
      startup: function () {},
      users: {findOneAsync: async function (id) { return MEMBERS[id]; }}
    }},
    'meteor/alanning:roles': {Roles: {userIsInRole: async function (userId, roles) {
      expect(roles).toEqual(['manager', 'compliance_manager', 'company_security_manager', 'account_admin']);
      return WRITERS.indexOf(userId) > -1;
    }}},
    '/imports/lib/collections/csaf': {
      allow: function (rules) { Object.assign(captured, rules); },
      deny: function () {},
      find: function () { return {}; }
    },
    '/imports/lib/collections/companies': {findOneAsync: async function (id) { return COMPANIES[id]; }},
    '/imports/lib/interactors/csaf/create': {
      CSAF_CREATE_ROLES: ['manager', 'compliance_manager', 'company_security_manager', 'account_admin']
    },
    '/imports/lib/csaf/feedAccess': require('../../imports/lib/csaf/feedAccess'),
    '../ServerUtils': {default: {makeRawCollection: function () { return {}; }}},
    '/imports/lib/security/sanitizeQuery': {asString: function (v) { return typeof v === 'string' ? v : null; }}
  }, {allowNoExports: true});

  const advisory = (tlp) => JSON.stringify({document: {category: 'csaf_vex', distribution: {tlp: {label: tlp}}}});
  const row = (overrides) => Object.assign({
    submitted: new Date(), companyId: 'c1', providerId: 'prov-c1', data: advisory('AMBER'),
    name: 'a.json', category: 'csaf_vex', tlp: 'AMBER', status: 'DRAFT'
  }, overrides);

  it('has insert only', () => {
    expect(typeof captured.insert).toBe('function');
    expect(captured.update).toBeUndefined();
    expect(captured.remove).toBeUndefined();
  });

  it('accepts a draft from a CSAF role in the caller\'s company', async () => {
    await expect(captured.insert('writer', row())).resolves.toBe(true);
    await expect(captured.insert('plain', row({companyId: 'c2', providerId: 'c2'}))).resolves.toBe(true);
  });

  it('refuses another company, a missing role or a logged-out caller', async () => {
    await expect(captured.insert('writer', row({companyId: 'c2', providerId: 'c2'}))).resolves.toBe(false);
    await expect(captured.insert('viewer', row())).resolves.toBe(false);
    await expect(captured.insert(null, row())).resolves.toBe(false);
  });

  it('refuses a providerId that is not the company\'s own', async () => {
    await expect(captured.insert('writer', row({providerId: 'c1'}))).resolves.toBe(false);
    await expect(captured.insert('writer', row({providerId: 'prov-other'}))).resolves.toBe(false);
  });

  it('refuses anything but a draft, and server-owned fields', async () => {
    await expect(captured.insert('writer', row({status: 'PUBLISHED'}))).resolves.toBe(false);
    await expect(captured.insert('writer', row({published: new Date()}))).resolves.toBe(false);
  });

  it('refuses a TLP label that does not match the document', async () => {
    await expect(captured.insert('writer', row({tlp: 'CLEAR'}))).resolves.toBe(false);
  });
});

describe('Tests insert (test-import-modal runs testImports/create.js in the browser)', () => {
  const MEMBERS = {
    dev: {_id: 'dev', profile: {companyId: 'c1'}},
    reader: {_id: 'reader', profile: {companyId: 'c1'}}
  };
  const MODULES = [{_id: 'm1', companyId: 'c1'}, {_id: 'm2', companyId: 'c2'}];
  const captured = {};
  loadMeteorModule('imports/server/collections/tests.js', {
    'meteor/meteor': {Meteor: {
      publish: function () {},
      startup: function () {},
      users: {findOneAsync: async function (id) { return MEMBERS[id]; }}
    }},
    'meteor/alanning:roles': {Roles: {userIsInRole: async function (userId) { return userId === 'dev'; }}},
    '/imports/lib/collections/tests': {
      allow: function (rules) { Object.assign(captured, rules); },
      deny: function () {},
      find: function () { return {}; }
    },
    '/imports/lib/collections/modules': {findOneAsync: async function (selector) {
      return MODULES.find((m) => m._id === selector._id && m.companyId === selector.companyId);
    }},
    '../ServerUtils': {default: {makeRawCollection: function () { return {}; }}},
    '/imports/lib/interactors/testImports/runRefs': {runRefsBelongTo: async function ({analysisId, scanId}) {
      return analysisId !== 'a-foreign' && scanId !== 's-foreign';
    }}
  }, {allowNoExports: true});

  const run = (overrides) => Object.assign({
    type: 'SARIF', submitted: new Date(), companyId: 'c1', moduleId: 'm1', analysisId: 'a1',
    data: '{}', status: 0, rules: {total: 0}, tool: 'semgrep'
  }, overrides);

  it('has insert only', () => {
    expect(typeof captured.insert).toBe('function');
    expect(captured.update).toBeUndefined();
    expect(captured.remove).toBeUndefined();
  });

  it('accepts a run for a module of the caller\'s company, or for no module', async () => {
    await expect(captured.insert('dev', run())).resolves.toBe(true);
    await expect(captured.insert('dev', run({moduleId: undefined}))).resolves.toBe(true);
  });

  it('refuses another company\'s module or company', async () => {
    await expect(captured.insert('dev', run({moduleId: 'm2'}))).resolves.toBe(false);
    await expect(captured.insert('dev', run({companyId: 'c2'}))).resolves.toBe(false);
    await expect(captured.insert('dev', run({moduleId: {$ne: null}}))).resolves.toBe(false);
  });

  it('refuses an analysis or scan the run reference check rejects', async () => {
    await expect(captured.insert('dev', run({analysisId: 'a-foreign'}))).resolves.toBe(false);
    await expect(captured.insert('dev', run({scanId: 's-foreign'}))).resolves.toBe(false);
  });

  it('refuses a caller without a module role or not logged in', async () => {
    await expect(captured.insert('reader', run())).resolves.toBe(false);
    await expect(captured.insert(null, run())).resolves.toBe(false);
  });

  it('refuses the demo marker and unknown fields', async () => {
    await expect(captured.insert('dev', run({demo: true}))).resolves.toBe(false);
    await expect(captured.insert('dev', run({extra: 1}))).resolves.toBe(false);
  });
});
