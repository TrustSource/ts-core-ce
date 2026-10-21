/* eslint-disable no-undef */
// API v2 is served by the app itself under /api/v2, with exactly the paths documented in
// public/api-v2/openapi.yaml. The spec no longer carries the AWS API Gateway proxy that
// used to forward v2 calls to /api/v1, and "Try it out" on /apidoc-latest calls this
// installation (servers: /api/v2).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO = path.join(__dirname, '../..');
const REST_API = 'imports/server/rest-api';
const SPEC = 'public/api-v2/openapi.yaml';

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

describe('API v2 spec: no API Gateway, served by this installation', () => {
  const text = read(SPEC);
  const spec = yaml.load(text);

  it('points "Try it out" at this installation', () => {
    expect(spec.servers).toEqual([{url: '/api/v2'}]);
    expect(text).not.toMatch(/api\.trustsource\.io/);
  });

  it('has no gateway proxy definitions and no OPTIONS mocks', () => {
    expect(text).not.toMatch(/x-amazon-apigateway/);
    Object.keys(spec.paths).forEach(function (p) {
      expect(Object.keys(spec.paths[p])).not.toContain('options');
    });
  });

  it('drops the operations with no local endpoint', () => {
    Object.keys(spec.paths).forEach(function (p) {
      expect(p).not.toMatch(/^\/(vulnerabilities|psirt)\//);
    });
    const tags = spec.tags.map(function (t) { return t.name; });
    expect(tags).not.toContain('Vulnerabilities');
    expect(tags).not.toContain('PSIRT');
  });

  it('keeps the x-api-key security scheme', () => {
    expect(spec.components.securitySchemes.api_key).toEqual({type: 'apiKey', name: 'x-api-key', in: 'header'});
    expect(text).not.toMatch(/x-apikey/);
  });
});

function restApiFiles() {
  return fs.readdirSync(path.join(REPO, REST_API))
    .filter(function (name) { return name.endsWith('.js') && !name.endsWith('.spec.js'); })
    .map(function (name) { return REST_API + '/' + name; });
}

// [route name, v2 path] for every REST route. Path parameters keep the handlers' names.
const ROUTES = [
  ['apiApprovesInitiateRoute', '/api/v2/compliance/approvals'],
  ['apiApproveRoute', '/api/v2/compliance/approvals/:id'],
  ['apiApprovalApproveRoute', '/api/v2/compliance/approvals/:id/approve'],
  ['apiApprovalRejectRoute', '/api/v2/compliance/approvals/:id/reject'],
  ['apiAuthorization', '/api/v2/account/authorization'],
  ['apiCheckLicenseRoute', '/api/v2/compliance/check/license'],
  ['apiCheckComponentRoute', '/api/v2/compliance/check/component'],
  ['apiCompanyFossRoute', '/api/v2/compliance/company/foss'],
  ['apiCsafFeedListRoute', '/api/v2/compliance/csaf/:key/documents'],
  ['apiCsafFeedDocumentRoute', '/api/v2/compliance/csaf/:key/documents/:id'],
  ['apiImportsScanCyclonedxRoute', '/api/v2/core/imports/scan/cyclonedx'],
  ['apiImportsScanCyclonedxJsonRoute', '/api/v2/core/imports/scan/cyclonedx/json'],
  ['apiImportsScanSpdxRoute', '/api/v2/core/imports/scan/spdx'],
  ['apiImportsScanSpdxJsonRoute', '/api/v2/core/imports/scan/spdx/:format'],
  ['apiModulesRoute', '/api/v2/core/modules'],
  ['apiModuleRoute', '/api/v2/core/modules/:id'],
  ['apiModulePartsListRoute', '/api/v2/core/modules/:id/partsList'],
  ['apiModuleSbomRoute', '/api/v2/core/modules/:id/sbom'],
  ['apiModuleAibomRoute', '/api/v2/core/modules/:id/aibom'],
  ['apiModuleCbomRoute', '/api/v2/core/modules/:id/cbom'],
  ['apiModuleEnvironmentalContextRoute', '/api/v2/core/modules/:id/environmental-context'],
  ['apiProductsRoute', '/api/v2/core/products'],
  ['apiProductRoute', '/api/v2/core/products/:id'],
  ['apiProductRetireRoute', '/api/v2/core/products/:id/retire'],
  ['apiProductUnretireRoute', '/api/v2/core/products/:id/unretire'],
  ['apiProductMisuseRoute', '/api/v2/core/products/:id/misuse'],
  ['apiProductMisuseItemRoute', '/api/v2/core/products/:id/misuse/:itemId'],
  ['apiProductSupportRoute', '/api/v2/core/products/:id/support'],
  ['apiProductSupportItemRoute', '/api/v2/core/products/:id/support/:itemId'],
  ['apiProductSolutionRoute', '/api/v2/core/products/:id/solution'],
  ['apiProductSolutionItemRoute', '/api/v2/core/products/:id/solution/:approvalId'],
  ['apiProductPhotoRoute', '/api/v2/core/products/:id/photo'],
  ['apiProductDocumentRoute', '/api/v2/core/products/:id/document'],
  ['apiProjectsRoute', '/api/v2/core/projects'],
  ['apiProjectRoute', '/api/v2/core/projects/:id'],
  ['apiProjectPartsListRoute', '/api/v2/core/projects/:id/partsList'],
  ['apiProjectSbomRoute', '/api/v2/core/projects/:id/sbom'],
  ['apiProjectAibomRoute', '/api/v2/core/projects/:id/aibom'],
  ['apiProjectCbomRoute', '/api/v2/core/projects/:id/cbom'],
  ['apiProjectEnvironmentalContextRoute', '/api/v2/core/projects/:id/environmental-context'],
  ['apiProjectArchitectureRoute', '/api/v2/core/projects/:id/architecture'],
  ['apiPublicReleaseSbomRoute', '/api/v2/compliance/releases/:id/sbom'],
  ['apiPublicReleaseNoticeRoute', '/api/v2/compliance/releases/:id/notice'],
  ['apiPublicReleaseVexRoute', '/api/v2/compliance/releases/:id/csaf'],
  ['apiPublicReleaseVexChangesRoute', '/api/v2/compliance/releases/:id/csaf-changes'],
  ['apiReportsVulRoute', '/api/v2/core/reports/vulnerabilities'],
  ['apiReportsVerRoute', '/api/v2/core/reports/versioning'],
  ['apiReportsViaRoute', '/api/v2/core/reports/viability'],
  ['apiReportsLicRoute', '/api/v2/core/reports/licenses'],
  ['apiReportsCveRoute', '/api/v2/core/reports/cve'],
  ['apiReportsAlgorithmsRoute', '/api/v2/core/reports/algorithms'],
  ['apiReportsEndoflifeRoute', '/api/v2/core/reports/endoflife'],
  ['apiReportsDashboardRoute', '/api/v2/core/reports/dashboard'],
  ['apiRisksRoute', '/api/v2/core/risks'],
  ['apiRiskRoute', '/api/v2/core/risks/:id'],
  ['apiRiskTasksRoute', '/api/v2/core/risks/:id/tasks'],
  ['apiRiskTaskRoute', '/api/v2/core/risks/:id/tasks/:taskId'],
  ['apiRiskCountermeasuresRoute', '/api/v2/core/risks/:id/countermeasures'],
  ['apiRiskCountermeasureRoute', '/api/v2/core/risks/:id/countermeasures/:cmId'],
  ['apiScansRoute', '/api/v2/core/scans'],
  ['apiScanRoute', '/api/v2/core/scans/:id'],
  ['apiScanReprocessRoute', '/api/v2/core/scans/:id/reprocess'],
  ['apiScanBinaryLinksRoute', '/api/v2/core/scans/:id/binaryLinks'],
  ['apiImportsTestSarifRoute', '/api/v2/core/tests/sarif'],
  ['apiImportsTestSarifJsonRoute', '/api/v2/core/tests/sarif/json'],
  ['apiTestsSarifDetailRoute', '/api/v2/core/tests/sarif/:id'],
  ['apiUsersNoLoginRoute', '/api/v2/core/users/nologin']
];

// Every `Router.route('<path>', {` with the `name:` on the next line, across the REST files.
function declaredRoutes() {
  const out = [];
  restApiFiles().forEach(function (file) {
    const re = /^Router\.route\('([^']+)', \{\n {2}name: '([^']+)',/gm;
    let m;
    while ((m = re.exec(read(file))) !== null) {
      out.push({file: file, path: m[1], name: m[2]});
    }
  });
  return out;
}

function byName(a, b) {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

// Compare paths with their parameters blanked: `:id` (router) and `{project_id}` (spec).
// The router's one `spdx/:format` route serves the spec's `spdx/json` and `spdx/rdf`.
function routeShape(p) {
  return p.replace(/:[A-Za-z]+/g, '{}');
}
function specShape(p) {
  return ('/api/v2' + p).replace(/\{[^}]+\}/g, '{}')
    .replace(/\/core\/imports\/scan\/spdx\/(json|rdf)$/, '/core/imports/scan/spdx/{}');
}

describe('API v2 routes match the spec one to one', () => {
  const spec = yaml.load(read(SPEC));

  it('declares exactly the v2 routes, under their names', () => {
    const declared = declaredRoutes()
      .filter(function (r) { return r.path.indexOf('/api/v2/') === 0; })
      .map(function (r) { return [r.name, r.path]; });
    expect(declared.slice().sort(byName)).toEqual(ROUTES.slice().sort(byName));
  });

  it('documents every v2 route and routes every documented path', () => {
    const documented = Array.from(new Set(Object.keys(spec.paths).map(specShape))).sort();
    const routed = Array.from(new Set(ROUTES.map(function (r) { return routeShape(r[1]); }))).sort();
    expect(routed).toEqual(documented);
  });

  it('declares tests/sarif/json before tests/sarif/:id, so "json" is never read as an id', () => {
    const tests = read(REST_API + '/tests.js');
    expect(tests.indexOf("Router.route('/api/v2/core/tests/sarif/json'"))
      .toBeLessThan(tests.indexOf("Router.route('/api/v2/core/tests/sarif/:id'"));
  });
});

describe('Handlers that read their own URL or route name work on the v2 paths', () => {
  const reports = read(REST_API + '/reports.js');

  function loadReportLabel() {
    const table = reports.match(/const PROJECT_REPORT_TYPES = \{[^}]*\};/);
    const fn = reports.match(/function reportLabel\(url\) \{[\s\S]*?\n\}/);
    expect(table).not.toBeNull();
    expect(fn).not.toBeNull();
    return new Function(table[0] + '\n' + fn[0] + '\nreturn reportLabel;')();
  }

  it.each([
    ['/api/v2/core/reports/vulnerabilities?projectId=p1', 'reports/vul'],
    ['/api/v2/core/reports/versioning', 'reports/ver'],
    ['/api/v2/core/reports/viability/', 'reports/via'],
    ['/api/v2/core/reports/licenses?projectId=p1&minConfidence=4', 'reports/lic'],
    ['/api/v2/core/reports/cve?projectId=p1', 'reports/cve'],
    ['/api/v2/core/reports/dashboard', 'reports/dashboard']
  ])('labels %s as %s', (url, label) => {
    expect(loadReportLabel()(url)).toBe(label);
  });

  it('labels every report request with reportLabel', () => {
    expect(reports.match(/let reportType = reportLabel\(this\.request\.url\);/g)).toHaveLength(5);
  });

  it('cuts no request URL at /api/v1/', () => {
    restApiFiles().forEach(function (file) {
      expect(read(file)).not.toMatch(/split\('\/api\/v1\/'\)/);
    });
    expect(read(REST_API + '/RestApi.js')).toMatch(/request\.url\.split\('\/api\/v2\/'\)\.pop\(\)/);
    expect(read(REST_API + '/users.js'))
      .toMatch(/RestApi\.requestLogger\(this\.request, this\.params, 'users\/nologin'\);/);
  });

  it('dispatches on the route names as declared', () => {
    expect(read(REST_API + '/products.js')).toMatch(/const routeOps = OPERATIONS\[this\.route\.getName\(\)\];/);
    expect(read(REST_API + '/releases.js'))
      .toMatch(/if\(this\.route\.getName\(\) === 'apiPublicReleaseVexChangesRoute'\)\{/);
    expect(read(REST_API + '/products.js') + read(REST_API + '/releases.js')).not.toMatch(/V1/);
  });
});

describe('The API key travels in x-api-key, and no version header is read', () => {
  it('has no x-apikey header read or CORS entry left', () => {
    const offenders = restApiFiles().filter(function (file) { return /x-apikey/i.test(read(file)); });
    expect(offenders).toEqual([]);
  });

  it('reads the key from x-api-key', () => {
    expect(read(REST_API + '/RestApi.js')).toMatch(/if \(!req\.headers\['x-api-key'\]\)/);
    expect(read(REST_API + '/authorization.js'))
      .toMatch(/getKeyMetaAndCompanyByAccountAndApiKey\(headers\['x-api-key'\]\)/);
  });

  it('stores apiVersion 2 on every REST scan without reading a version header', () => {
    restApiFiles().forEach(function (file) {
      expect(read(file)).not.toMatch(/headers\.version|headers\['version'\]/);
    });
    expect(read(REST_API + '/scans.js')).toMatch(/^const API_VERSION = 2;$/m);
  });
});

describe('test_api calls API v2', () => {
  // The REST specs and their helpers; the *.unit.spec.js files do not call the server.
  const files = fs.readdirSync(path.join(REPO, 'test_api/helpers'))
    .filter(function (name) { return name.endsWith('.js'); })
    .map(function (name) { return 'test_api/helpers/' + name; })
    .concat(fs.readdirSync(path.join(REPO, 'test_api/specs'))
      .filter(function (name) { return name.endsWith('.spec.js') && !name.endsWith('.unit.spec.js'); })
      .map(function (name) { return 'test_api/specs/' + name; }));

  it('sends x-api-key and no version header', () => {
    const offenders = files.filter(function (file) {
      return /'x-apikey'|\.set\('version'|version: '2'/.test(read(file));
    });
    expect(offenders).toEqual([]);
  });

  it('builds every request path under core, account or compliance', () => {
    const wrong = [];
    files.forEach(function (file) {
      (read(file).match(/\$\{BASE\}\/[A-Za-z_-]+/g) || []).forEach(function (mention) {
        if (!/^\$\{BASE\}\/(core|account|compliance)$/.test(mention) && mention !== '${BASE}/SOME_STRANGE_URL') {
          wrong.push(file + ': ' + mention);
        }
      });
    });
    expect(wrong).toEqual([]);
  });

  it('no longer resets demo data through the API', () => {
    expect(fs.existsSync(path.join(REPO, 'test_api/specs/_reset.spec.js'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'test_api/specs/demo.spec.js'))).toBe(false);
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['test:clean']).toBeUndefined();
    expect(scripts.test).toBe('jest ./test_api/');
    expect(read('test_api/README.md')).not.toMatch(/test:clean|\/api\/v1/);
  });
});

describe('Other callers use this installation\'s API v2', () => {
  it('points public release QR codes at this installation', () => {
    const src = read('imports/client/ui/settings/api/company-public-release.js');
    expect(src).not.toMatch(/api\.trustsource\.io/);
    // The key is revealed by the server first (#46); the link is built from it.
    expect(src).toContain('Meteor.absoluteUrl(`api/v2/compliance/releases/${plainKey}/${path}/`)');
    ['sbom', 'notice', 'csaf'].forEach(function (doc) {
      expect(src).toContain(`showQrCode(this.id, '${doc}')`);
    });
  });

  it('has no commented-out gateway proxy left', () => {
    expect(read(REST_API + '/catchall-route.js')).not.toMatch(/redirectV2Requests|api\.trustsource\.io/);
  });

  it('names no v1 path, x-apikey or version header in the docs', () => {
    ['tests/cydx/README-1.7-manual-test.md']
      .forEach(function (file) {
        expect(read(file)).not.toMatch(/api\/v1|x-apikey|version'?: '2'/);
      });
  });

  it('names no v1 path in comments outside the route definitions', () => {
    ['imports/lib/component/checksumFormat.js', 'imports/lib/licenseResolution/resolutionEntry.js',
      'imports/server/scan/dependencyDepth.js', REST_API + '/apiSchema.spec.js']
      .concat(restApiFiles())
      .forEach(function (file) {
        const lines = read(file).split('\n').filter(function (line) {
          return line.indexOf("Router.route('/api/v1/") !== 0;
        });
        expect(lines.filter(function (line) { return /\/api\/v1\//.test(line); })).toEqual([]);
      });
  });
});

describe('API v1 is gone', () => {
  it('declares no /api/v1 route and no V1-named route', () => {
    const routes = declaredRoutes();
    expect(routes.filter(function (r) { return r.path.indexOf('/api/v1') === 0; })).toEqual([]);
    expect(routes.filter(function (r) { return /V1$/.test(r.name); })).toEqual([]);
    expect(routes.filter(function (r) { return r.path.indexOf('/api/v2/') === 0; })).toHaveLength(ROUTES.length);
  });

  it('names no /api/v1 path anywhere in the REST files', () => {
    restApiFiles().forEach(function (file) {
      expect(read(file)).not.toMatch(/\/api\/v1/);
    });
  });

  it('drops the endpoints that had no v2 counterpart', () => {
    expect(fs.existsSync(path.join(REPO, REST_API, 'csaf.js'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, REST_API, 'demo.js'))).toBe(false);
    const register = read('imports/startup/server/register-restapi.js');
    expect(register).not.toMatch(/rest-api\/(csaf|demo)\.js/);
    expect(register).toMatch(/rest-api\/csaf-feed\.js/);
    expect(read(REST_API + '/releases.js')).not.toMatch(/VerifyRelease|Signature|verify-Releases/);
  });
});
