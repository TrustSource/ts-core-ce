/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The security follow-ups the vulnerability-alerts review surfaced.
//
// None of the six was caused by that work; they were kept out of that branch to keep
// its diff reviewable. Each `describe` is numbered as the issue numbers them,
// and executes the shipped source wherever the module's import list can be stood
// up under Jest. Where it cannot (imports/server/collections/modules.js pulls in
// most of the server), the guarantee is locked structurally instead, in the
// style of cwe-risk-wiring.source.unit.spec.js.
//
// Item 5 is asserted as ALREADY CLOSED: the `logEvent` DDP entry point has
// derived the actor from `this.userId` for a while. The test exists so the
// finding cannot be reopened silently.
// ---------------------------------------------------------------------------
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');
const triggers = require('../../imports/lib/company/webhookTriggers');
const displayName = require('../../imports/lib/user/displayName');

const CO = 'company-owner';
const OTHER_CO = 'company-other';
const PROJECT = 'prj1111111111111';
const APPROVE = 'apr1111111111111';

const COMPANY_LIST_JS = 'imports/client/ui/settings/integrations/company-webhooks.js';
const PROJECT_LIST_JS = 'imports/client/ui/project/project-settings-webhooks.js';
const COMPANY_LIST_HTML = 'imports/client/ui/settings/integrations/company-webhooks.html';
const WEBHOOKS_SERVER_JS = 'imports/server/collections/webhooks.js';
const ACCESS_JS = 'imports/lib/company/webhookAccess.js';
const CREATE_JS = 'imports/lib/interactors/webhooks/create.js';
const MODULES_JS = 'imports/server/collections/modules.js';
const LIVE_JS = 'imports/lib/interactors/projects/vulnerabilityLive.js';
const LOGEVENTS_JS = 'imports/server/collections/logevents.js';
const LOGEVENT_JS = 'imports/server/logEvent.js';
const COMPANIES_JS = 'imports/server/collections/companies.js';

// The real access module, with the only collection it touches stubbed. Loaded
// REAL because projectBelongsToCompany IS the decision item 6 is about.
function loadAccess(projectRows) {
  const queries = [];
  return {
    queries,
    module: loadMeteorModule(ACCESS_JS, {
      '/imports/lib/collections/projects': {default: {findOneAsync: async function (selector) {
        queries.push(selector);
        return (projectRows || []).find(function (row) {
          return row._id === selector._id && row.companyId === selector.companyId;
        });
      }}}
    })
  };
}

// --- 1. stored XSS in the company webhooks URL column ------------------------

describe('#141.1 the webhooks URL cell no longer builds its own markup', () => {
  it('neither list page constructs a SafeString at all', () => {
    [COMPANY_LIST_JS, PROJECT_LIST_JS].forEach(function (file) {
      const source = readSourceWithoutComments(file);
      expect(source).not.toContain('SafeString');
      expect(source).not.toContain('Spacebars');
    });
  });

  it('renders url and headers through Blaze templates, which escape', () => {
    const source = readSourceWithoutComments(COMPANY_LIST_JS);
    expect(source).toContain('Template.reactiveTableWebhookUrlCell');
    expect(source).toContain('Template.reactiveTableWebhookHeadersCell');
    const html = readSourceWithoutComments(COMPANY_LIST_HTML);
    expect(html).toMatch(/<template name="reactiveTableWebhookUrlCell">/);
    // #46: the masked url; the stored one is encrypted and never published.
    expect(html).toContain('title="{{urlDisplay}}">{{urlDisplay}}</span>');
    // A triple-stash is the same hole under a different spelling.
    expect(html).not.toContain('{{{');
  });

  it('the project page reuses the same two cells rather than its own copies', () => {
    const source = readSourceWithoutComments(PROJECT_LIST_JS);
    expect(source).toContain('Template.reactiveTableWebhookUrlCell');
    expect(source).toContain('Template.reactiveTableWebhookHeadersCell');
  });

  it('the headers cell no longer strips quotes in place of escaping', () => {
    [COMPANY_LIST_JS, PROJECT_LIST_JS].forEach(function (file) {
      expect(readSourceWithoutComments(file)).not.toContain('.split(\'"\').join(\'\')');
    });
  });

  it('the two columns still built by a fn return PLAIN strings, which Blaze escapes', () => {
    // reactive-table renders `{{getField ..}}` - a double stash. A plain string
    // is escaped; only a SafeString is not. Both remaining fn columns run a
    // stored value through the shared label map, so the map must answer with a
    // primitive even for a value it does not know.
    const hostile = '"><img src=x onerror=alert(1)>';
    const type = triggers.webhookTypeLabel(hostile);
    const trigger = triggers.webhookTriggersLabel([hostile]);
    expect(typeof type).toBe('string');
    expect(typeof trigger).toBe('string');
    // Echoed verbatim - the escaping is Blaze's job, not the map's, and a map
    // that quietly rewrote the value would hide a hand-edited document.
    expect(type).toBe(hostile);
    expect(trigger).toBe(hostile);
  });
});

// --- 2. the publications shipped receiver credentials to every member --------

describe('#141.2 the webhook publications', () => {
  function loadPublications(options) {
    const opts = options || {};
    const published = {};
    const finds = [];
    const roleAsks = [];
    loadMeteorModule(WEBHOOKS_SERVER_JS, {
      'meteor/meteor': {Meteor: {
        publish: function (name, handler) { published[name] = handler; },
        startup: function () {},
        users: {findOneAsync: async function () {
          return Object.prototype.hasOwnProperty.call(opts, 'user')
            ? opts.user : {_id: 'u1', profile: {companyId: CO}};
        }}
      }},
      'meteor/alanning:roles': {Roles: {userIsInRole: async function (userId, roles, scope) {
        roleAsks.push({userId, roles, scope});
        return opts.role !== false;
      }}},
      '/imports/lib/collections/webhooks': {
        find: function (selector, findOptions) {
          finds.push({selector, options: findOptions});
          return {__cursor: true};
        },
        allow: function () {}
      },
      '/imports/server/ServerUtils': {default: {makeRawCollection: function () { return {}; }}},
      '/imports/lib/security/ssrfGuard': require('../../imports/lib/security/ssrfGuard'),
      '/imports/lib/company/webhookAccess': {
        WEBHOOK_ADMIN_ROLES: ['account_admin', 'manager', 'compliance_manager'],
        projectBelongsToCompany: async function () { return opts.project !== false; }
      }
    }, {allowNoExports: true});
    return {published, finds, roleAsks};
  }

  // `this` for a publish handler: only `ready` and `userId` are reached here.
  function subscription(userId) {
    const readied = [];
    return {ctx: {userId, ready: function () { readied.push(true); }}, readied};
  }

  it('publishes nothing to a company member who holds none of the three roles', async () => {
    const {published, finds} = loadPublications({role: false});
    const company = subscription('u1');
    const project = subscription('u1');
    expect(await published.webhooks.call(company.ctx)).toBeUndefined();
    expect(await published.webhooksByProjectId.call(project.ctx, PROJECT)).toBeUndefined();
    expect(finds).toHaveLength(0);
    expect(company.readied).toHaveLength(1);
    expect(project.readied).toHaveLength(1);
  });

  it('asks for exactly the roles that may create a receiver, in the user\'s company', async () => {
    const {published, roleAsks} = loadPublications();
    await published.webhooks.call(subscription('u1').ctx);
    expect(roleAsks).toHaveLength(1);
    expect(roleAsks[0].roles).toEqual(['account_admin', 'manager', 'compliance_manager']);
    expect(roleAsks[0].scope).toBe(CO);
  });

  it('publishes only the fields the two list pages render', async () => {
    const {published, finds} = loadPublications();
    await published.webhooks.call(subscription('u1').ctx);
    await published.webhooksByProjectId.call(subscription('u1').ctx, PROJECT);
    expect(finds).toHaveLength(2);
    finds.forEach(function (call) {
      expect(call.options && call.options.fields).toBeDefined();
      expect(call.selector.companyId).toBe(CO);
      // Stored but rendered nowhere - and `userId` in particular identifies who
      // configured the receiver.
      expect(call.options.fields.userId).toBeUndefined();
      expect(call.options.fields.userName).toBeUndefined();
    });
    expect(finds[1].selector.projectId).toBe(PROJECT);
  });

  it('refuses a non-string projectId instead of putting it in the selector', async () => {
    const {published, finds} = loadPublications();
    for (const hostile of [{$ne: null}, {$gt: ''}, ['a'], 7, null, undefined, '']) {
      const sub = subscription('u1');
      expect(await published.webhooksByProjectId.call(sub.ctx, hostile)).toBeUndefined();
      expect(sub.readied).toHaveLength(1);
    }
    expect(finds).toHaveLength(0);
  });

  it('publishes nothing when there is no session, and nothing for a user with no company',
    async () => {
      const anonymous = loadPublications({user: null});
      const noSession = subscription(undefined);
      expect(await anonymous.published.webhooks.call(noSession.ctx)).toBeUndefined();
      expect(anonymous.finds).toHaveLength(0);

      const homeless = loadPublications({user: {_id: 'u1', profile: {}}});
      const sub = subscription('u1');
      expect(await homeless.published.webhooks.call(sub.ctx)).toBeUndefined();
      expect(homeless.finds).toHaveLength(0);
    });
});

// --- 3. checkComponent read its project and module by bare id ---------------

describe('#141.3 checkComponent is company-scoped', () => {
  // modules.js pulls in most of the server, so this is asserted structurally.
  // The method resolves the company and hands it to checkComponentForCompany, which
  // the REST check calls with the API key's company; the reads live in that function.
  function checkComponentBody() {
    const source = readSourceWithoutComments(MODULES_JS);
    const start = source.indexOf('checkComponent: async function');
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, start + 1400);
  }

  function checkComponentForCompanyBody() {
    const source = readSourceWithoutComments(MODULES_JS);
    const start = source.indexOf('export async function checkComponentForCompany(');
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, start + 1400);
  }

  it('resolves the caller\'s company and refuses a session without one', () => {
    const body = checkComponentBody();
    expect(body).toMatch(/Meteor\.userAsync\(\)/);
    expect(body).toMatch(/user\.profile\.companyId/);
    expect(body).toMatch(/throw new Meteor\.Error\(403/);
    expect(body).toMatch(/checkComponentForCompany\(companyId, projectId, moduleId, components\)/);
  });

  it('scopes BOTH reads, and no longer reads either by a bare id', () => {
    const body = checkComponentForCompanyBody();
    expect(body).toMatch(/Projects\.findOneAsync\(\{_id: projectId, companyId\}\)/);
    expect(body).toMatch(/Modules\.findOneAsync\(\{_id: moduleId, companyId\}\)/);
    expect(body).not.toMatch(/Projects\.findOneAsync\(projectId\)/);
    expect(body).not.toMatch(/Modules\.findOneAsync\(moduleId\)/);
  });

  it('answers a foreign id with a miss rather than dereferencing undefined', () => {
    const body = checkComponentForCompanyBody();
    // The line after the reads used to be `module.confidenceMinScore ||
    // project.confidenceMinScore`, which throws TypeError once a scoped read can
    // legitimately return nothing.
    const guard = body.indexOf('if (!project || !module)');
    const use = body.indexOf('module.confidenceMinScore');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(use);
  });
});

// --- 4. the release snapshot was read unscoped by company -------------------

describe('#141.4 the frozen release snapshot is read inside the tenant', () => {
  function loadLive() {
    return loadMeteorModule(LIVE_JS, {
      'underscore': require('underscore'),
      '/imports/lib/collections/projects': {default: {}},
      '/imports/lib/collections/modules': {default: {}},
      '/imports/lib/collections/cves': {default: {}},
      '/imports/lib/collections/companies': {default: {}},
      '/imports/lib/collections/approvalReports': {default: {}},
      '/imports/lib/collections/manualVulnerabilities': {default: {}},
      '/imports/lib/component/Vulnerability': {default: {}},
      '/imports/lib/component/SemverExt': {default: {}}
    });
  }

  it('carries the company, and keeps the legacy arm for snapshots without one', () => {
    const {approvalReportSelector} = loadLive();
    expect(approvalReportSelector(APPROVE, CO)).toEqual({
      type: 'vulnerability',
      approveId: APPROVE,
      $or: [{companyId: CO}, {companyId: {$exists: false}}]
    });
  });

  it('cannot be widened by an operator object in approve._id', () => {
    const {approvalReportSelector} = loadLive();
    [{$ne: null}, {$gt: ''}, ['a'], 7, null, undefined].forEach(function (hostile) {
      const selector = approvalReportSelector(hostile, CO);
      expect(typeof selector.approveId).toBe('string');
      // An empty id matches no document, which is the fail-closed answer.
      expect(selector.approveId).toBe('');
    });
  });

  it('is what computeVulnerabilityDifference actually uses', () => {
    const source = readSourceWithoutComments(LIVE_JS);
    expect(source).toMatch(/ApprovalReports\.findOneAsync\(approvalReportSelector\(/);
    expect(source).not.toMatch(/\{type: 'vulnerability', approveId: approve\._id\}/);
  });

  it('is the SAME selector the public VEX feed reads through', () => {
    // Two copies of a tenant scope is two chances for one to lose it, and the
    // feed carried the unscoped read this issue is about.
    [COMPANIES_JS].forEach(function (file) {
      const source = readSourceWithoutComments(file);
      expect(source).toContain('approvalReportSelector');
      expect(source).not.toMatch(/\{type:'vulnerability',approveId:approve\._id\}/);
    });
  });
});

// --- 5. already closed, pinned so it cannot reopen --------------------------

describe('#141.5 logEvent ignores a client-supplied user object over DDP', () => {
  function loadLogEvents(sessionUser) {
    const methods = {};
    const written = [];
    const Meteor = {
      isServer: true,
      Error: function (code, reason) { this.error = code; this.reason = reason; },
      methods: function (map) { Object.assign(methods, map); },
      publish: function () {},
      startup: function () {},
      users: {findOneAsync: async function () { return sessionUser; }},
      userAsync: async function () { return sessionUser; }
    };
    // The REAL writer, so the record's companyId is the one that would be stored.
    const realLogEvent = loadMeteorModule(LOGEVENT_JS, {
      'meteor/meteor': {Meteor},
      '/imports/lib/collections/companies': {default: {findOneAsync: async function (id) {
        return {_id: id, name: 'Company ' + id};
      }}},
      '/imports/lib/collections/logevents': {default: {insertAsync: async function (doc) {
        written.push(doc);
        return 'log1';
      }}},
      '/imports/lib/user/displayName': displayName
    });
    loadMeteorModule(LOGEVENTS_JS, {
      'meteor/meteor': {Meteor},
      '/imports/lib/collections/logevents': {default: {find: function () { return {}; }}},
      '/imports/server/logEvent': {default: realLogEvent.default,
        logEventsTypes: realLogEvent.logEventsTypes},
      'meteor/momentjs:moment': {moment: function () { return {subtract: function () {
        return {toISOString: function () { return new Date().toISOString(); }};
      }}; }},
      '/imports/server/ServerUtils': {default: {getCompanyIdForUserAsync: async function () { return CO; },
        escapeRegex: function (v) { return v; }, makeRawCollection: function () { return {}; }}},
      '/imports/server/serverSideCollection': {default: {find: function () { return {}; }}},
      '/imports/lib/collections/scans': {default: {}},
      '/imports/lib/collections/modules': {default: {}},
      '/imports/lib/security/sanitizeQuery': {stripDangerousOperators: function (s) { return s; }},
      'underscore': require('underscore')
    }, {allowNoExports: true});
    return {methods, written};
  }

  const FORGED = {_id: 'attacker', profile: {companyId: OTHER_CO, name: 'Victim Admin'},
    emails: [{address: 'victim@other.example'}]};

  it('attributes the entry to the SESSION user, not the object the client sent', async () => {
    const session = {_id: 'u1', profile: {companyId: CO, name: 'Real User'},
      emails: [{address: 'real@owner.example'}]};
    const {methods, written} = loadLogEvents(session);
    await methods.logEvent.call({connection: {id: 'c1'}, userId: 'u1'},
      FORGED, 'something happened', 'userLogin');
    expect(written).toHaveLength(1);
    expect(written[0].companyId).toBe(CO);
    expect(written[0].userId).toBe('u1');
    expect(written[0].account).toBe('real@owner.example');
  });

  it('refuses an unauthenticated DDP call outright', async () => {
    const {methods, written} = loadLogEvents(null);
    await expect(methods.logEvent.call({connection: {id: 'c1'}, userId: null},
      FORGED, 'x', 'userLogin')).rejects.toBeDefined();
    expect(written).toHaveLength(0);
  });

  it('still honours a server-internal call, which has no connection', async () => {
    const {methods, written} = loadLogEvents(null);
    await methods.logEvent.call({connection: null},
      {_id: 'svc', profile: {companyId: CO}, emails: [{address: 'svc@owner.example'}]},
      'scan processed', 'scanProcessing');
    expect(written).toHaveLength(1);
    expect(written[0].companyId).toBe(CO);
  });
});

// --- 6. a webhook could be filed against a foreign project ------------------

describe('#141.6 a webhook\'s projectId must belong to the caller\'s company', () => {
  it('allows a company-level receiver, which carries no projectId', async () => {
    const {module, queries} = loadAccess([]);
    for (const absent of [undefined, null, '']) {
      expect(await module.projectBelongsToCompany(absent, CO)).toBe(true);
    }
    // No project row is a company-level receiver, so nothing is looked up.
    expect(queries).toHaveLength(0);
  });

  it('allows a project of the caller\'s own company', async () => {
    const {module, queries} = loadAccess([{_id: PROJECT, companyId: CO}]);
    expect(await module.projectBelongsToCompany(PROJECT, CO)).toBe(true);
    expect(queries[0]).toEqual({_id: PROJECT, companyId: CO});
  });

  it('refuses another company\'s project, and one that does not exist', async () => {
    const {module} = loadAccess([{_id: PROJECT, companyId: OTHER_CO}]);
    expect(await module.projectBelongsToCompany(PROJECT, CO)).toBe(false);
    expect(await module.projectBelongsToCompany('prj9999999999999', CO)).toBe(false);
  });

  it('refuses an operator object rather than interpolating it', async () => {
    const {module, queries} = loadAccess([{_id: PROJECT, companyId: CO}]);
    for (const hostile of [{$ne: null}, {$gt: ''}, ['a'], 7]) {
      expect(await module.projectBelongsToCompany(hostile, CO)).toBe(false);
    }
    expect(queries).toHaveLength(0);
  });

  it('refuses when the caller has no company at all', async () => {
    const {module} = loadAccess([{_id: PROJECT, companyId: CO}]);
    expect(await module.projectBelongsToCompany(PROJECT, undefined)).toBe(false);
    expect(await module.projectBelongsToCompany(PROJECT, '')).toBe(false);
  });

  it('is applied by the interactor AND by the allow rule, which bypasses it', () => {
    // The allow rule lets a manager insert straight from the browser without
    // going through the interactor - the exact path that made the alerts work duplicate the
    // SSRF gate onto the insert.
    [CREATE_JS, WEBHOOKS_SERVER_JS].forEach(function (file) {
      expect(readSourceWithoutComments(file)).toContain('projectBelongsToCompany');
    });
  });
});

// --- the shared declarations these fixes lean on ----------------------------

describe('#141 one declaration per rule', () => {
  it('the admin role list is declared once and inlined nowhere', () => {
    const {module} = loadAccess([]);
    expect(module.WEBHOOK_ADMIN_ROLES)
      .toEqual(['account_admin', 'manager', 'compliance_manager']);
    [CREATE_JS, WEBHOOKS_SERVER_JS].forEach(function (file) {
      const source = readSourceWithoutComments(file);
      expect(source).toContain('WEBHOOK_ADMIN_ROLES');
      expect(source).not.toMatch(/\['account_admin',\s*'(manager|compliance_manager)'/);
    });
  });

  it('the public VEX feed reads ONE confidence floor', () => {
    [COMPANIES_JS].forEach(function (file) {
      const source = readSourceWithoutComments(file);
      expect(source).toContain('PUBLIC_VEX_CONFIDENCE');
      expect(source).not.toMatch(/fromVulnerabilityReport\(data,\s*[34],/);
    });
    const vex = readSourceWithoutComments('imports/lib/converter/vex.js');
    expect(vex).toMatch(/const PUBLIC_VEX_CONFIDENCE = 4;/);
  });

  it('the webhook TYPE labels come from the shared map, in the dialog and both lists', () => {
    expect(triggers.webhookTypeLabel('teamsWorkflow')).toBe('Microsoft Teams Workflow');
    expect(triggers.webhookTypeLabel('teams')).toBe('Microsoft Teams');
    // The dialog's wording is allowed to be longer than a table cell's.
    const options = triggers.webhookTypeOptions();
    expect(options.map(function (o) { return o.value; }))
      .toEqual(['webhook', 'teamsWorkflow', 'slack', 'teams', 'gitter']);
    expect(options.find(function (o) { return o.value === 'gitter'; }).disabled).toBe(true);
    expect(options.find(function (o) { return o.value === 'teams'; }).label)
      .toMatch(/Deprecated/);
    [COMPANY_LIST_JS, PROJECT_LIST_JS,
      'imports/client/ui/settings/common/company-webhooks-create.js'].forEach(function (file) {
      expect(readSourceWithoutComments(file)).not.toContain('toTitleCase');
    });
  });
});
