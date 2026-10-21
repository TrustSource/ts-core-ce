/* eslint-disable no-undef*/
// The wiring guards.
//
// Most of this feature is testable as pure functions (sarif-cwe-risk-plan and
// cwe-risk-idempotency do that). What is NOT reachable from Jest is the wiring:
// the unique index that makes two concurrent imports safe, the try/catch that
// keeps a risk-register failure from failing a SARIF upload, the method
// registration that must forward exactly two arguments, and the promise that
// cweRiskPlan.js stays free of meteor/* so it can live in the client bundle.
//
// `yarn meteor-test` is broken at boot in this repo, so those guarantees are
// locked structurally instead, in the source-assertion style established by
// csaf-product-id-wiring.source.unit.spec.js.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// Comment-blind assertions would happily pass on a commented-out call.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const PLAN_JS = 'imports/lib/sarif/cweRiskPlan.js';
const MANAGED_JS = 'imports/lib/interactors/riskProperties/managedFields.js';
const RECONCILE_JS = 'imports/lib/interactors/riskProperties/reconcileFromSarif.js';
const TOGGLE_JS = 'imports/lib/interactors/projects/updateAutoCreateCweRisks.js';
const RISK_INDEX_JS = 'imports/lib/interactors/riskProperties/index.js';
const PROJECT_INDEX_JS = 'imports/lib/interactors/projects/index.js';
const RISK_UPDATE_JS = 'imports/lib/interactors/riskProperties/update.js';
const RISK_CREATE_JS = 'imports/lib/interactors/riskProperties/create.js';
const RISK_SCHEMA_JS = 'imports/lib/schemas/riskSchema.js';
const PROJECT_SCHEMA_JS = 'imports/lib/schemas/projectSchema.js';
const RISK_COLLECTION_JS = 'imports/server/collections/riskProperties.js';
const RISK_STARTUP_JS = 'imports/startup/server/riskProperties.js';
const PROJECT_STARTUP_JS = 'imports/startup/server/project.js';
const RATE_LIMIT_JS = 'imports/startup/server/rate-limit.js';
const LOG_EVENT_JS = 'imports/server/logEvent.js';
const REST_TESTS_JS = 'imports/server/rest-api/tests.js';
const REST_PROJECTS_JS = 'imports/server/rest-api/projects.js';
const MODAL_JS = 'imports/client/ui/code-tests/test-import-modal.js';
const FINDING_SUMMARY_JS = 'imports/lib/sarif/findingSummary.js';

// ---------------------------------------------------------------------------
// AC31: the planner is pure CommonJS, requirable by Jest and safe in the client
// bundle (the risk detail view imports its level constants).
// ---------------------------------------------------------------------------

describe('AC31: cweRiskPlan.js is meteor-free and reusable', () => {
  const raw = read(PLAN_JS);
  const live = stripComments(raw);

  it('imports nothing from meteor/ and nothing server-only', () => {
    expect(raw).not.toMatch(/require\(\s*['"]meteor\//);
    expect(raw).not.toMatch(/from\s+['"]meteor\//);
    expect(live).not.toMatch(/imports\/server\//);
    expect(live).not.toMatch(/\bMongo\b|\bMeteor\b/);
  });

  it('uses module.exports rather than ESM, so require() works', () => {
    expect(live).toMatch(/module\.exports\s*=/);
    expect(live).not.toMatch(/^\s*export\s/m);
  });

  it('reuses normalizeTool and the tool cap instead of re-declaring them', () => {
    // Both already exist in cweMappingOverlay.js. A second copy is how the two
    // sides of the identity key drift apart.
    expect(live).toMatch(/require\(['"]\.\/cweMappingOverlay['"]\)/);
    expect(live).not.toMatch(/function\s+normalizeTool/);
    expect(live).not.toMatch(/CWE_MAPPING_TOOL_MAX\s*=/);
  });

  it('reuses fileOfLocation from findingSummary.js instead of copying it', () => {
    expect(live).toMatch(/require\(['"]\.\/findingSummary['"]\)/);
    expect(live).not.toMatch(/function\s+fileOfLocation/);
    // ...which means findingSummary.js has to export it.
    expect(stripComments(read(FINDING_SUMMARY_JS))).toMatch(/module\.exports\s*=\s*\{[\s\S]*fileOfLocation/);
  });

  it('never spells a SARIF level outside the two level constants (AC9 non-vacuity)', () => {
    // AC9 says the level must play no part in the create/skip decision. A test
    // asserting "warning findings create Risks too" is vacuous if the planner
    // simply has no level branch to get wrong, so the absence is asserted here.
    const withoutConstants = live
      .split('\n')
      .filter((line) => !/^const SOURCE_REF_LEVELS? /.test(line) &&
        !/^const SOURCE_REF_LEVEL_LABEL /.test(line))
      .join('\n');
    ['error', 'warning', 'note'].forEach((level) => {
      expect(withoutConstants).not.toContain("'" + level + "'");
      expect(withoutConstants).not.toContain('"' + level + '"');
    });
  });
});

describe('#129 managedFields.js and the reconcile interactor stay in their lanes', () => {
  it('managedFields.js is pure CommonJS, so riskSchema can re-export from it', () => {
    const raw = read(MANAGED_JS);
    expect(raw).not.toMatch(/from\s+['"]meteor\//);
    expect(raw).not.toMatch(/require\(\s*['"]meteor\//);
    expect(stripComments(raw)).toMatch(/module\.exports\s*=/);
  });

  it('reconcileFromSarif.js never reaches into the client tree', () => {
    // Server-only by contract: its only import site is the riskProperties
    // barrel, which imports/startup/server/riskProperties.js alone imports.
    expect(stripComments(read(RECONCILE_JS))).not.toMatch(/imports\/client\//);
  });

  it('is exported from the barrels the startup files import', () => {
    expect(stripComments(read(RISK_INDEX_JS))).toContain('RiskPropertiesReconcileFromSarif');
    expect(stripComments(read(PROJECT_INDEX_JS))).toContain('ProjectsUpdateAutoCreateCweRisks');
  });
});

// ---------------------------------------------------------------------------
// AC18 / AC20: the unique PARTIAL index is what turns two concurrent imports
// into one Risk, and what keeps every hand-made Risk (no autoKey) out of it.
// ---------------------------------------------------------------------------

describe('AC18/AC20: the autoKey unique partial index', () => {
  const live = stripComments(read(RISK_COLLECTION_JS));

  it('is created unique and partial on riskProperties.autoKey', () => {
    expect(live).toMatch(/riskProperties\.autoKey/);
    expect(live).toContain('unique: true');
    expect(live).toContain('partialFilterExpression');
    // $exists: true, not $type: 'string' - the planner has to be able to prove
    // the lookup selector is a subset of the filter to actually use the index.
    expect(live).toMatch(/partialFilterExpression:\s*\{'riskProperties\.autoKey':\s*\{\$exists:\s*true\}\}/);
  });

  // COMPOUND with companyId. A globally unique autoKey enforces the same thing
  // today (the key is derived from a moduleId, which belongs to one company) but
  // makes one tenant's row able to refuse another's insert: the loser's E11000
  // falls through to a re-read inside its OWN company, misses, and answers
  // `skipped` - a permanent silent cross-tenant denial. The reconcile's lookup
  // selector is exactly {companyId, 'riskProperties.autoKey'}.
  it('is scoped to the company, so no tenant can deny another one an identity', () => {
    expect(live).toMatch(/\{companyId:\s*1,\s*'riskProperties\.autoKey':\s*1\}/);
    const reconcile = stripComments(read(RECONCILE_JS));
    expect(reconcile).toMatch(
      /\{companyId:\s*context\.companyId,\s*'riskProperties\.autoKey':\s*risk\.autoKey\}/);
  });

  it('is not awaited and cannot crash startup', () => {
    // Meteor 3 binds the HTTP port only after every startup hook resolves, so a
    // blocking index build keeps /healthcheck unanswered long enough for the ALB
    // to abort a rollout. A rejected build must still reach the task log.
    expect(live).not.toMatch(/await\s+RawRiskProperties\.createIndex/);
    const call = live.slice(live.indexOf('riskProperties_company_autoKey_unique'));
    expect(call).toMatch(/\.catch\(/);
  });

  // Found on a real server, which is the only place it was ever visible:
  // createIndex only ADDS, so an environment that ran an earlier build of this feature
  // kept the globally-unique `riskProperties_autoKey_unique` next to the
  // compound one and went on enforcing uniqueness across tenants. Reproduced
  // there: with both indexes present, company A holding a key made company B's
  // insert of the same key fail E11000 naming the old index - the precise
  // denial the compound key was introduced to remove. Every later deploy hid it,
  // because the new index is created successfully and nothing complains.
  it('drops its globally-unique predecessor, tolerating IndexNotFound', () => {
    expect(live).toMatch(/dropIndex\('riskProperties_autoKey_unique'\)/);
    const drop = live.slice(live.indexOf("dropIndex('riskProperties_autoKey_unique')"));
    // Not awaited, for the same /healthcheck reason as the build above.
    expect(live).not.toMatch(/await\s+RawRiskProperties\.dropIndex/);
    expect(drop).toMatch(/\.catch\(/);
    // 27 is IndexNotFound - the normal answer everywhere that never ran the
    // earlier build, so it must be swallowed rather than logged as a failure.
    expect(drop).toMatch(/code === 27|index not found/i);
  });
});

// ---------------------------------------------------------------------------
// The managed fields are enforced in code, because denyUpdate is a no-op here.
// ---------------------------------------------------------------------------

describe('#129 RiskProperties.Update / .Create strip the managed fields', () => {
  const update = stripComments(read(RISK_UPDATE_JS));
  const create = stripComments(read(RISK_CREATE_JS));

  it('update.js strips after sanitizeModifier and before the write', () => {
    const call = update.indexOf('stripManagedRiskFields(modifier');
    expect(call).toBeGreaterThan(-1);
    expect(update.indexOf('sanitizeModifier(modifier)')).toBeLessThan(call);
    expect(call).toBeLessThan(update.indexOf('RiskProperties.updateAsync'));
  });

  it('update.js reads the stored subdocument only for a wholesale write', () => {
    expect(update).toContain('touchesRiskPropertiesWholesale');
  });

  it('create.js strips before the payload is cleaned', () => {
    expect(create).toContain('stripManagedRiskProperties');
    expect(create).toMatch(/Utils\.cleanObject\(\s*stripManagedRiskProperties\(/);
  });

  it('neither relies on denyUpdate, which is a no-op in the vendored schema', () => {
    const schema = stripComments(read(RISK_SCHEMA_JS));
    const managedBlock = schema.slice(schema.indexOf('autoKey'), schema.indexOf('sourceRefsPrevCount'));
    expect(managedBlock).not.toContain('denyUpdate');
  });
});

// ---------------------------------------------------------------------------
// Schema fields
// ---------------------------------------------------------------------------

describe('#129 schema fields', () => {
  const risk = stripComments(read(RISK_SCHEMA_JS));
  const project = stripComments(read(PROJECT_SCHEMA_JS));

  it('declares all seven riskProperties fields', () => {
    ['autoKey', 'autoTool', 'autoCwe', 'sourceRefs', 'sourceRefsTotal',
      'sourceRefsTruncated', 'sourceRefsPrevCount'].forEach((field) => {
      expect(risk).toMatch(new RegExp('\\b' + field + ':\\s*\\{'));
    });
    expect(risk).toMatch(/'sourceRefs\.\$':\s*\{[^}]*blackbox:\s*true/);
  });

  it('re-exports UNTOUCHED_RISK_STATES so the client can import it from the schema', () => {
    expect(risk).toContain('UNTOUCHED_RISK_STATES');
    expect(risk).toMatch(/from\s+['"][^'"]*riskProperties\/managedFields['"]/);
  });

  // --- added with the security fix round (rec 2) ---------------------------
  //
  // cweRiskPlan.js may not import riskSchema.js: the schema pulls in
  // meteor/aldeed:simple-schema and the planner lives in the client bundle. So
  // the three lengths it has to stay inside are declared twice, and this is what
  // makes a drift between the copies fail loudly instead of reappearing as a
  // tool that silently produces nothing on every import for ever.
  it('pins the planner\'s length constants value-equal to the schema\'s maxes', () => {
    const plan = require('../../imports/lib/sarif/cweRiskPlan');
    function maxOf(field) {
      const start = risk.indexOf('\n  ' + field + ': {');
      expect(start).toBeGreaterThan(-1);
      const block = risk.slice(start, risk.indexOf('}', start));
      const match = block.match(/max:\s*(\d+)/);
      expect(match).not.toBeNull();
      return parseInt(match[1], 10);
    }
    expect(plan.AUTO_TOOL_MAX).toEqual(maxOf('autoTool'));
    expect(plan.AUTO_KEY_MAX).toEqual(maxOf('autoKey'));
    // RISK_NAME_MAX mirrors RiskSchema.name, which lives outside the
    // riskProperties subschema.
    const nameStart = risk.indexOf('\n  name: {');
    expect(plan.RISK_NAME_MAX)
      .toEqual(parseInt(risk.slice(nameStart, risk.indexOf('}', nameStart))
        .match(/max:\s*(\d+)/)[1], 10));
  });

  it('declares autoCreateCweRisks on the project WITHOUT a defaultValue', () => {
    // ProjectSchema.clean() runs on the plain document in cleanAndValidateProject,
    // so a defaultValue is applied on the REST POST path to every project the API
    // touches. Default OFF here
    // means "absent", and every read is a strict === true.
    const block = project.slice(project.indexOf('autoCreateCweRisks'));
    const field = block.slice(0, block.indexOf('}'));
    expect(field).toContain('type: Boolean');
    expect(field).toContain('optional: true');
    expect(field).not.toContain('defaultValue');
  });
});

// ---------------------------------------------------------------------------
// Method registration
// ---------------------------------------------------------------------------

describe('#129 method registration', () => {
  const riskStartup = stripComments(read(RISK_STARTUP_JS));
  const projectStartup = stripComments(read(PROJECT_STARTUP_JS));

  it('registers RiskProperties.ReconcileFromSarif', () => {
    expect(riskStartup).toContain("'RiskProperties.ReconcileFromSarif'");
  });

  it('forwards exactly two arguments - no ...args, no .apply', () => {
    // A third argument from a DDP client must never reach the interactor: it is
    // where companyId and actor would be injected.
    const start = riskStartup.indexOf("'RiskProperties.ReconcileFromSarif'");
    const handler = riskStartup.slice(start, riskStartup.indexOf('\n', riskStartup.indexOf('}', start)));
    expect(handler).toMatch(/function\s*\(moduleId,\s*testIds\)/);
    expect(handler).not.toContain('...args');
    expect(handler).not.toContain('.apply(');
  });

  it('is NOT wrapped in gatedByFeature', () => {
    // The Community Edition has one tier: every company has every feature, so
    // there is no gatedByFeature wrapper anywhere any more. Pinned here so a
    // regression that reintroduces a feature-licence gate on this method is
    // caught.
    const line = riskStartup.split('\n')
      .find((entry) => entry.indexOf("'RiskProperties.ReconcileFromSarif'") !== -1);
    expect(line).not.toContain('gatedByFeature');
  });

  it('registers Projects.UpdateAutoCreateCweRisks', () => {
    expect(projectStartup).toContain("'Projects.UpdateAutoCreateCweRisks'");
    expect(projectStartup).toContain('ProjectsUpdateAutoCreateCweRisks');
  });

  it('rate-limits the reconcile per connection', () => {
    const rate = stripComments(read(RATE_LIMIT_JS));
    expect(rate).toContain('RiskProperties.ReconcileFromSarif');
  });

  // --- added with the security fix round -----------------------------------
  //
  // A per-connection rule bounds one tab. A client chooses how many DDP
  // connections it opens, so the effective limit is the rule times however many
  // it opens; the per-user rule is the one that bounds the actor.
  it('rate-limits the reconcile per USER as well as per connection', () => {
    const rate = stripComments(read(RATE_LIMIT_JS));
    const rules = rate.split('DDPRateLimiter.addRule')
      .filter((block) => block.indexOf('RiskProperties.ReconcileFromSarif') !== -1);
    expect(rules.length).toEqual(2);
    expect(rules.some((block) => /connectionId\(\)/.test(block))).toBe(true);
    expect(rules.some((block) => /userId\(userId\)/.test(block))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC28 + architect risk #2: seven logEvent keys, not two.
// ---------------------------------------------------------------------------

describe('AC28: the log event types are registered', () => {
  const live = stripComments(read(LOG_EVENT_JS));

  it('registers both new keys, so Company Logs shows a label instead of a blank', () => {
    expect(live).toContain("key:'cweRiskCreated'");
    expect(live).toContain("key:'cweRiskSourceRefsUpdated'");
  });

  it('registers the five sibling keys that were already emitted but unregistered', () => {
    // riskPropertiesCreate/Remove and tasksCreate/Update/Remove are emitted by
    // interactors next door and show a blank label today. Fixing two of seven
    // instances of one defect in the feature area being touched would just
    // relocate it.
    ["key:'riskPropertiesCreate'", "key:'riskPropertiesRemove'", "key:'tasksCreate'",
      "key:'tasksUpdate'", "key:'tasksRemove'"].forEach((key) => {
      expect(live).toContain(key);
    });
  });

  it('gives them a non-blank shared label', () => {
    expect(live).toMatch(/const RISK_MOD = '[^']+'/);
  });
});

// ---------------------------------------------------------------------------
// AC30: a reconcile failure must never fail the SARIF import.
// ---------------------------------------------------------------------------

describe('AC30: failure isolation on both import paths', () => {
  const rest = stripComments(read(REST_TESTS_JS));

  it('the REST route calls the reconcile in its own try/catch', () => {
    expect(rest).toContain('RiskPropertiesReconcileFromSarif');
    const start = rest.indexOf('RiskPropertiesReconcileFromSarif({');
    expect(start).toBeGreaterThan(-1);
    const before = rest.slice(0, start);
    // The nearest preceding block opener is the reconcile's own try.
    expect(before.lastIndexOf('try {')).toBeGreaterThan(before.lastIndexOf('await TestImportsCreate'));
    expect(rest.slice(start)).toMatch(/^[\s\S]{0,600}?\}\s*catch\s*\(/);
  });

  it('runs the reconcile before response.end so a POST-then-GET spec is deterministic', () => {
    const reconcile = rest.indexOf('RiskPropertiesReconcileFromSarif({');
    const created = rest.indexOf('response.statusCode = 201');
    expect(reconcile).toBeGreaterThan(-1);
    expect(reconcile).toBeLessThan(created);
  });

  it('never echoes the reason to the caller - it can quote the uploaded document', () => {
    const start = rest.indexOf('RiskPropertiesReconcileFromSarif({');
    const afterCatch = rest.slice(rest.indexOf('catch (error) {', start));
    // The catch body: everything up to the 201 the import answers with anyway.
    const body = afterCatch.slice(0, afterCatch.indexOf('response.statusCode = 201'));
    expect(body).toMatch(/console\.error/);
    expect(body).not.toMatch(/response\./);
  });

  it('the Blaze upload modal fires the reconcile and swallows its failure', () => {
    const modal = stripComments(read(MODAL_JS));
    expect(modal).toContain("'RiskProperties.ReconcileFromSarif'");
    const start = modal.indexOf("'RiskProperties.ReconcileFromSarif'");
    expect(modal.slice(start, start + 300)).toContain('.catch(');
  });
});

// ---------------------------------------------------------------------------
// AC3: the toggle is readable over REST.
// ---------------------------------------------------------------------------

describe('AC3: autoCreateCweRisks is in the single-project GET projection', () => {
  it('is listed in PROJECT_API_FIELDS', () => {
    // The projection moved out of the handler into a module-level constant that the update
    // arm's read-back now shares (a follow-up narrowed that echo, which used to
    // return the whole document including jira/tfs/github credentials). The field still has
    // to be in it, and the GET arm still has to be what uses it - both asserted, so this
    // cannot pass because the read stopped projecting altogether.
    const live = stripComments(read(REST_PROJECTS_JS));
    const declaration = live.indexOf('const PROJECT_API_FIELDS = {');
    expect(declaration).toBeGreaterThan(-1);
    expect(live.slice(declaration, live.indexOf('};', declaration)))
      .toMatch(/autoCreateCweRisks\s*:\s*1/);
    const start = live.indexOf('const project = await Projects.findOneAsync(query');
    expect(start).toBeGreaterThan(-1);
    expect(live.slice(start, start + 200)).toMatch(/fields:\s*PROJECT_API_FIELDS/);
  });

  // --- added with the security fix round (finding 6) -----------------------
  //
  // The generic project POST accepts a `developer`-scoped key, while the DDP
  // toggle behind the same field requires manager-level roles. Left as it was,
  // one CI credential could enable the register's auto-write mode, upload the
  // SARIF that populates it, and switch it off again - a capability the UI
  // reserves for managers. The two surfaces now name the same three roles.
  //
  // A later change GENERALISED this guard from the one field name to a LIST, because
  // the same hole reopens for every ProjectSchema field a later feature adds.
  // The guarantee is unchanged and is still asserted here: `autoCreateCweRisks`
  // in the body demands a manager-level scope, and the roles match the DDP
  // method's. What moved is that the check is now a membership test.
  it('POST requires a manager-level scope for the toggle field specifically', () => {
    const live = stripComments(read(REST_PROJECTS_JS));
    expect(live).toMatch(
      /MANAGER_ONLY_POST_ROLES\s*=\s*\['account_admin',\s*'manager',\s*'compliance_manager'\]/);
    const fields = live.slice(live.indexOf('MANAGER_ONLY_POST_FIELDS = ['));
    expect(fields.slice(0, fields.indexOf(']'))).toContain("'autoCreateCweRisks'");
    const guard = live.slice(live.indexOf('MANAGER_ONLY_POST_FIELDS.some('));
    expect(guard.slice(0, 400)).toContain('MANAGER_ONLY_POST_ROLES');
    expect(guard.slice(0, 400)).toContain('403');
    // ...and the same three the DDP method authorizes on.
    const toggle = stripComments(read(TOGGLE_JS));
    expect(toggle)
      .toMatch(/\['account_admin',\s*'manager',\s*'compliance_manager'\]/);
  });

  it('the toggle write scopes both of its selectors to the caller\'s company', () => {
    const toggle = stripComments(read(TOGGLE_JS));
    expect(toggle).toMatch(/typeof projectId !== 'string'/);
    expect(toggle).toMatch(/findOneAsync\(\{_id: projectId, companyId\}/);
    expect(toggle).toMatch(/updateAsync\(\{_id: projectId, companyId\}/);
  });

  it('is documented in the OpenAPI project settings schema', () => {
    const yaml = read('public/api-v2/openapi.yaml');
    const start = yaml.indexOf('    ProjectSettings:');
    expect(start).toBeGreaterThan(-1);
    expect(yaml.slice(start, yaml.indexOf('    RequestBodyCreateProject:', start)))
      .toContain('autoCreateCweRisks:');
  });
});

// ---------------------------------------------------------------------------
// The toggle's write path deliberately avoids the autoForm.
// ---------------------------------------------------------------------------

describe('AC2: the toggle uses a dedicated method, not isModificationAllowed', () => {
  const live = stripComments(read(TOGGLE_JS));

  it('derives the company from the caller and never from an argument', () => {
    expect(live).toMatch(/Meteor\.userAsync\(\)/);
    expect(live).toMatch(/user\.profile\.companyId/);
    expect(live).toMatch(/function\s*\(projectId,\s*enabled\)/);
  });

  it('checks the role and then the project ownership', () => {
    expect(live).toContain('Roles.userIsInRole');
    expect(live).toMatch(/project\.companyId\s*!==\s*companyId/);
  });

  it('coerces the stored value, because every read is a strict === true', () => {
    expect(live).toMatch(/autoCreateCweRisks:\s*enabled === true/);
  });
});

// ---------------------------------------------------------------------------
// The risk portfolio has to count the shape the importer writes.
//
// listQuery.js documents three stored shapes, and shape 3 - {projectId,
// moduleId} together - is what every TM-agent risk uses and what the CWE
// risk reconcile writes. getPortfolio's per-module query required projectId to be
// ABSENT, so it counted only shape 2: on a real server the risk list showed 11
// CWE risks while the overview rendered "No risks tracked yet" beside it.
//
// The project branch must stay project-only. It is rendered as its own
// "Project risks" row next to one row per module, so widening it the same way
// would count every module risk twice.
// ---------------------------------------------------------------------------

describe('#129 getPortfolio counts module risks that also carry a projectId', () => {
  const portfolio = stripComments(read('imports/lib/interactors/riskProperties/getPortfolio.js'));

  it('does not require projectId to be absent on the per-module query', () => {
    const moduleBranch = portfolio.slice(
      portfolio.indexOf('if(params.moduleId)'), portfolio.indexOf('else if(params.projectId)'));
    expect(moduleBranch).toMatch(/moduleId:\s*params\.moduleId/);
    expect(moduleBranch).not.toMatch(/projectId:\s*\{\$exists:\s*false\}/);
  });

  it('keeps the project query project-only, so module risks are not double counted', () => {
    const projectBranch = portfolio.slice(portfolio.indexOf('else if(params.projectId)'));
    expect(projectBranch).toMatch(/projectId:\s*params\.projectId/);
    expect(projectBranch).toMatch(/moduleId:\s*\{\$exists:\s*false\}/);
  });
});
