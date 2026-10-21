
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Utils from '/imports/server/ServerUtils';
import Tests from '/imports/lib/collections/tests';
import TestImportsCreate from '/imports/lib/interactors/testImports/create';
import RestApi from './RestApi';
import {resolveModuleRef} from './moduleResolver';
import {helpers} from './apiSchema';
import {getFindingsSummary} from '/imports/lib/sarif/runStatus';
import {formatCweFindings} from '/imports/lib/sarif/cweExtract';
import {indexMappings, applyMappings} from '/imports/lib/sarif/cweMappingOverlay';
import CweMappingsFindForCompany from '/imports/lib/interactors/cweMappings/findForCompany';
import RiskPropertiesReconcileFromSarif from '/imports/lib/interactors/riskProperties/reconcileFromSarif';

// Read scope for security-agent consumers.
const READ_ROLES = ['manager', 'compliance_manager', 'portfolio_manager', 'company_security_manager'];
const FETCH_LIMIT = 100;

Router.route('/api/v2/core/tests/sarif', {
  name: 'apiImportsTestSarifRoute',
  where: 'server',
  action: RestApi.wrapAsync(importTestsSarif),
  trackPageView: false
});

Router.route('/api/v2/core/tests/sarif/json', {
  name: 'apiImportsTestSarifJsonRoute',
  where: 'server',
  action: RestApi.wrapAsync(importTestsSarif),
  trackPageView: false,
  onBeforeAction: RestApi.parseFile
});

// Defined after the literal /json route, so ':id' never captures it.
Router.route('/api/v2/core/tests/sarif/:id', {
  name: 'apiTestsSarifDetailRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleSarifDetailRoute),
  trackPageView: false
});

async function importTestsSarif() {
  if (this.request.method === 'GET') {
    setJsonResponseHeaders(this.response);
    await handleSarifList(this.request, this.params, this.response);
    return;
  }
  await importScan('sarif', this.request, this.params, this.response)
}

async function handleSarifDetailRoute() {
  RestApi.requestLogger(this.request, this.params, 'tests/sarif/:id');
  setJsonResponseHeaders(this.response);
  if (this.request.method === 'GET') {
    await handleSarifDetail(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

function setJsonResponseHeaders(response) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', '*');
  response.setHeader('Access-Control-Allow-Headers',
    'Content-Length,Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');
}

async function importScan(type, request, params, response) {
  RestApi.requestLogger(request, params, `tests/${type}`);
  response.statusCode = 200;   // default OK
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', '*');
  response.setHeader('Access-Control-Allow-Headers',
    'Content-Length,Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');
  if (request.method === 'POST') {
    await handlePost(type, request, params, response);
  } else if (request.method === 'OPTIONS') {
    handleOptions(response);
  } else {
    response.statusCode = 405;
    response.end(JSON.stringify('Method Not Allowed'));
  }
}

//
//    OPTIONS
//
function handleOptions(response) {
  // console.log('now in handleOptions');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.end();
}

// `moduleName`/`projectName` are the canonical parameter names across the ingest
// endpoints; `module`/`project` (what /scans and the SBOM import endpoints call them)
// are accepted as aliases so a client does not have to spell the same thing two ways.
function applyNameAliases(params) {
  if (!params.moduleName && typeof params.module === 'string') {
    params.moduleName = params.module;
  }
  if (!params.projectName && typeof params.project === 'string') {
    params.projectName = params.project;
  }
}

//
//    POST Requests
//
async function handlePost(type, request, requestParams, response) {
  const body = request.body;
  const params = requestParams.query;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.statusCode = 400;
    response.end(JSON.stringify({
      error: 'Bad Request',
      messages: ['Request body must be a non-empty JSON object']
    }));
    return;
  }

  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey( headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {

    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
      'company_security_manager', 'company_component_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify('API-key scope is limited'));
      return;
    }

    response.setHeader('Cache-Control', 'no-cache, no-store');

    const companyId = keyMetaAndCompany.company._id;
    const analysisId = params.analysisId ? params.analysisId : undefined;
    // `projectName`/`moduleName` are canonical here; `project`/`module` are accepted as
    // aliases so one spelling works across /scans, /imports/scan/* and this endpoint.
    applyNameAliases(params);
    const projectName = typeof params.projectName === 'string' && params.projectName ? params.projectName : undefined;
    const moduleName = typeof params.moduleName === 'string' && params.moduleName ? params.moduleName : undefined;
    const demo = params.demo === true || params.demo === 'true';   // only when explicitly requested (e.g. API tests); normal usage omits it

    // Same resolver the scan and SBOM import paths use, so a SARIF upload lands on the
    // module a dependency scan already created for that name instead of duplicating it.
    const resolved = await resolveModuleRef({
      companyId,
      user: keyMetaAndCompany.user,
      demo,
      moduleId: params.moduleId,
      scanId: params.scanId,
      analysisId,
      projectName,
      moduleName,
      // Only a name reaches this endpoint, so a module created here still gets its
      // identifier derived from it - unchanged from before. Matching no longer depends on
      // that derivation agreeing with the one the scan and import paths use: the resolver
      // falls back to the module's name inside the project.
      moduleIdentifier: moduleName ? Utils.cleanAndFixIdentifier(moduleName) : undefined,
      create: true,
      // A SARIF document is not a dependency scan; stamping the module as scanned would
      // make the module list report its analysis as outdated.
      touchScanned: false,
      allowCompanyWideNameMatch: true
    });
    if (resolved.error) {
      response.statusCode = resolved.error.statusCode;
      response.end(JSON.stringify(resolved.error.body));
      return;
    }
    const moduleId = resolved.moduleId;
    const scanId = resolved.scanId;
    // Feed the resolved ids back into the query params so the stored test document
    // carries them even when the caller only named the module.
    if (moduleId) { params.moduleId = moduleId; }
    if (scanId) { params.scanId = scanId; }
    const denormProjectName = (resolved.project && resolved.project.name) || projectName;
    const denormModuleName = (resolved.module && resolved.module.name) || moduleName;

    const context = helpers.cleanAndValidateImport(type, body, params);
    const contextParams = helpers.cleanAndValidateTestParams(params);
    if (context.isValid() && contextParams.isValid()) {
      try {
        const {tests} = await TestImportsCreate( {moduleId, analysisId, scanId,
          projectName: denormProjectName, moduleName: denormModuleName,
          companyId, file: body, type, demo}, function () {
          // callback kept for backward compatibility; response handled below via return value
        });
        // Keep the risk register in step with the weaknesses this
        // document published, when the project is set to. Deliberately BEFORE
        // response.end, so a POST followed immediately by a GET sees the risks
        // and no work runs against a torn-down request. Skipped outright when the
        // module could not be resolved: the tests are stored unattached, so there
        // is no project whose toggle could apply.
        //
        // The work this adds to the request is bounded by the planner, not by a
        // rate limit: at most CWE_RISK_MAX_TOOLS buckets and
        // CWE_RISKS_MAX_PER_IMPORT risks, with each occurrence entry's ruleId and
        // uri capped, so the amplification factor between the uploaded body and
        // what is written is fixed rather than a function of the document.
        //
        // NOTE (security review, defense-in-depth follow-up): this route has NO
        // request-rate throttle, and the repo has no mechanism to give it one -
        // the same conclusion handleArchitecturePost reached in
        // imports/server/rest-api/projects.js. Inventing a bespoke limiter here
        // would not be the reusable one this needs, so it is flagged, not
        // improvised: the follow-up is a generic per-API-key limiter wired into
        // RestApi.wrapAsync, which would cover every endpoint at once. The DDP
        // path IS limited (imports/startup/server/rate-limit.js, per connection
        // AND per user).
        let riskLimitMessage = null;
        try {
          if (moduleId) {
            const reconciled = await RiskPropertiesReconcileFromSarif({
              moduleId, testIds: tests, companyId, actor: keyMetaAndCompany.user});
            riskLimitMessage = (reconciled && reconciled.limitMessage) || null;
          }
        } catch (error) {
          // AC30: the document IS stored and the module quality IS updated - a
          // risk-register failure must not turn a successful import into a 400.
          // Logged, never returned: the reason can quote a tool name or a rule
          // id out of the uploaded document.
          console.error('tests/sarif: CWE risk reconcile failed for module ' + moduleId + ' -',
            (error && error.message) || error);
        }
        response.statusCode = 201;
        const unresolvedMsg = 'attention: module could not be resolved from moduleId, ' +
          `analysisId '${analysisId}', scanId '${scanId}', or projectName/moduleName! ` +
          'Test will not be attached to a module';
        const result = {
          tests,
          moduleId: moduleId ? moduleId : unresolvedMsg
        };
        if (riskLimitMessage) {
          // The tests are stored in full; only risk creation was capped.
          result.warnings = [riskLimitMessage];
        }
        response.end(JSON.stringify(result));
      } catch (error) {
        // An analysis or scan of another company (or another module) is refused.
        if (error && error.error === 403) {
          response.statusCode = 403;
          response.end(JSON.stringify({error: 'Forbidden', messages: ['Access Denied']}));
          return;
        }
        response.statusCode = 400;
        response.end(JSON.stringify({
          error: 'Bad Request',
          object: {
            error: error.toString()
          },
          messages: [error.toString()]
        }));
      }
    } else if (!context.isValid()) {
      response.statusCode = 400;
      const respStr = RestApi.createErrorResponse(context);
      response.end(respStr);
    } else if (!contextParams.isValid()) {
      response.statusCode = 400;
      const respStr = RestApi.createErrorResponse(contextParams);
      response.end(respStr);
    }
  }
}

//
//    GET Requests (expose uploaded SARIF documents to security agents)
//

// Resolves the API key and enforces the read scope.
// Returns the key/company context, or writes the error response and returns null.
async function authorizeSarifRead(request, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return null;
  }
  if (!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, READ_ROLES)) {
    response.statusCode = 403;
    response.end(JSON.stringify('API-key scope is limited'));
    return null;
  }
  response.setHeader('Cache-Control', 'no-cache, no-store');
  return keyMetaAndCompany;
}

function mapSarifListItem(doc, mappingIndex) {
  return {
    _id: doc._id,
    type: doc.type,
    origin: doc.tool,
    submitted: doc.submitted,
    status: doc.status,
    projectName: doc.projectName,
    moduleName: doc.moduleName,
    moduleId: doc.moduleId,
    scanId: doc.scanId,
    analysisId: doc.analysisId,
    rules: doc.rules && {
      // Distinct rules that fired per severity, out of the tool's declared rule
      // catalog. `total` is that catalog, not the rules applied to the scanned files -
      // SARIF carries no count of the latter. `findings` below counts
      // the actual results.
      total: doc.rules.total,
      violations: doc.rules.violations,
      warnings: doc.rules.warnings,
      notes: doc.rules.notes
    },
    // `cwes` breaks the same findings down by weakness, so an
    // API consumer (such as a threat-model tool) can mark them on the component a module maps to
    // without fetching and parsing the run. These counts do not reconcile with
    // `total`: a rule declaring several CWEs counts under each and a weakness
    // seen at two levels appears once per level, while findings from rules whose
    // tool published no CWE are not counted here at all - absent rather than
    // guessed at, so an empty array means "this tool told us nothing", not "no
    // weaknesses".
    //
    // A weakness a Security Manager assigned to an unclassified rule is counted
    // here too, and a finding is counted once no matter which of
    // the two named it. The row says nothing about where the weakness came from:
    // it is cwe/count/level, exactly as first published, and openapi.yaml
    // documents those three. Applied over the stored per-rule counts, so it
    // reaches documents imported before any of this existed.
    findings: Object.assign(getFindingsSummary(doc.rules),
      {cwes: formatCweFindings(applyMappings(doc.rules && doc.rules.byCwe,
        doc.rules && doc.rules.byRule, mappingIndex, doc.tool))})
  };
}

// GET /api/v2/core/tests/sarif - newest first; optional filters narrow the list.
// Returns metadata only (origin tool, dates, finding counts), not the runs.
async function handleSarifList(request, requestParams, response) {
  RestApi.requestLogger(request, requestParams, 'tests/sarif (list)');
  const keyMetaAndCompany = await authorizeSarifRead(request, response);
  if (!keyMetaAndCompany) { return; }

  const query = (requestParams && requestParams.query) || {};
  const filter = {companyId: keyMetaAndCompany.company._id, type: 'SARIF'};
  // String-type enforcement on user-supplied selector values (no operator objects).
  for (const field of ['moduleId', 'scanId', 'analysisId', 'projectName', 'moduleName', 'origin']) {
    if (typeof query[field] === 'string' && query[field]) {
      filter[field === 'origin' ? 'tool' : field] = query[field];
    }
  }

  // Same paging convention as the projects list: 1-based
  // `page` query param, 100 entries per page, plain array response.
  const page = +query.page > 0 ? Math.floor(+query.page) : 1;
  const docs = await Tests.find(filter, {
    sort: {submitted: -1},
    skip: Math.floor((page - 1) * FETCH_LIMIT),
    limit: FETCH_LIMIT,
    fields: {data: 0, companyId: 0}
  }).fetchAsync();

  // One read for the whole page: manual assignments are company-wide, so the
  // same index serves every document in the response.
  const mappingIndex = await companyMappingIndex(keyMetaAndCompany.company._id);
  response.end(JSON.stringify(docs.map(function (doc) {
    return mapSarifListItem(doc, mappingIndex);
  })));
}

async function companyMappingIndex(companyId) {
  return indexMappings(await CweMappingsFindForCompany(companyId), companyId);
}

// GET /api/v2/core/tests/sarif/:id - full document: metadata plus the stored run
// wrapped back into a SARIF envelope, so findings and fixes are readable as-is.
async function handleSarifDetail(request, params, response) {
  const keyMetaAndCompany = await authorizeSarifRead(request, response);
  if (!keyMetaAndCompany) { return; }

  const doc = await Tests.findOneAsync({
    _id: params.id,
    companyId: keyMetaAndCompany.company._id,
    type: 'SARIF'
  }, {fields: {companyId: 0}});
  if (!doc) {
    response.statusCode = 404;
    response.end(JSON.stringify('Resource not found: ' + params.id));
    return;
  }

  let run = null;
  try {
    run = doc.data ? JSON.parse(doc.data) : null;
  } catch (error) {
    console.warn('SARIF detail: stored run is not parseable JSON for test ' + doc._id, error.toString());
  }
  const result = mapSarifListItem(doc, await companyMappingIndex(keyMetaAndCompany.company._id));
  result.sarif = run ? {version: '2.1.0', runs: [run]} : null;
  response.end(JSON.stringify(result));
}

