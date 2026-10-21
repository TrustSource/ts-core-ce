/* eslint-disable no-undef */
// Generated documents, reports and UI links name this installation (ROOT_URL), the
// company that publishes them and the app itself - never the hosted service.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('installation address', () => {
  const config = read('imports/config.js');

  it('Config.appUrl is derived from ROOT_URL with a trailing slash', () => {
    expect(config).toMatch(/get appUrl\(\) \{\s*return resolveAppUrl\(\);/);
    expect(config).toMatch(/process\.env\.ROOT_URL/);
    expect(config).toMatch(/__meteor_runtime_config__\.ROOT_URL/);
    expect(config).toMatch(/url\.endsWith\('\/'\) \? url : url \+ '\/'/);
  });

  it('is handed to the workers as APP_URL', () => {
    expect(read('imports/server/workerRunner/index.js')).toMatch(/APP_URL: AppConfig\.appUrl,/);
  });
});

describe('no hosted-service address in documents, reports or UI', () => {
  const FILES = [
    'imports/config.js',
    'imports/lib/converter/vex.js',
    'imports/client/ui/csaf/csaf-create.js',
    'imports/lib/cyclonedx/writer.js',
    'imports/lib/interactors/SPDXExports/generate.js',
    'imports/lib/reports/reportConverter.js',
    'imports/lib/reports/reportServices.js',
    'imports/startup/server/manualVulnerabilities.js',
    'imports/lib/component/Version.js',
    'imports/lib/component/Vulnerability.js',
    'imports/client/ui/common/cves-details/cves-details.js',
    'imports/client/ui/module/common/component-cves-details.js',
    'imports/client/ui/approves/common/approves-vulnerability.js',
    'imports/client/ui/releases/common/report-vulnerability-list.js',
    'imports/client/ui/reports/report-impact-cve/report-impact-cve.js',
    'imports/client/ui/reports/report-vulnerability/report-vulnerability-by-cve.js',
    'imports/client/ui/reports/report-vulnerability/report-vulnerability-by-path.js'
  ];

  it.each(FILES)('%s', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/trustsource\.io/);
    expect(src).not.toMatch(/Product and Service Security|TrustSource-CSAF|ECS 1\.1\.0|Organization: 'EACG'/);
  });

  it('vulnerability sources link to this installation\'s Vulnerability Lake', () => {
    ['imports/lib/component/Version.js', 'imports/lib/component/Vulnerability.js',
      'imports/client/ui/common/cves-details/cves-details.js'].forEach((file) => {
      expect(read(file)).toMatch(/url: Config\.appUrl \+ 'vulnerability_lake'/);
    });
  });
});

describe('CSAF/VEX documents', () => {
  const vex = read('imports/lib/converter/vex.js');

  it('are published by the company, from this installation', () => {
    expect(vex).toMatch(/name: \(company && company\.name\) \|\| Config\.name,\s*namespace: Config\.appUrl/);
    expect(vex).toMatch(/url: `\$\{Config\.appUrl\}csaf\/json\/\$\{encodeURIComponent\(id\)\}\.json`/);
  });

  it('name this application as the generator', () => {
    expect(vex).toMatch(/engine: \{\s*name: Config\.name,\s*version: Config\.version\s*\}/);
    expect(read('imports/client/ui/csaf/csaf-create.js')).toMatch(/engine: \{\s*name: Config\.name,\s*version: Config\.version\s*\}/);
  });
});

describe('CycloneDX documents', () => {
  const writer = require('../../imports/lib/cyclonedx/writer.js');
  const {version} = require('../../package.json');

  it('list this application and its version as the tool', () => {
    const doc = writer.buildDocument({tree: {dependencies: []}, company: {name: 'Acme'}}, 'SBOM');
    expect(doc.metadata.tools.components).toContainEqual({type: 'application', name: 'TrustSource CE', version});
    expect(JSON.stringify(doc)).not.toMatch(/trustsource\.io/);
  });
});

describe('SPDX documents', () => {
  it('are created by the company with this application', () => {
    const src = read('imports/lib/interactors/SPDXExports/generate.js');
    expect(src).toMatch(/Organization: \(company && company\.name\) \|\| Config\.name,/);
    expect(src).toMatch(/Tool: `\$\{Config\.name\} \$\{Config\.version\}`/);
    expect(read('imports/lib/reports/reportConverter.js')).toMatch(/documentNamespace = `\$\{Config\.appUrl\}spdx\/\$\{SPDXkey\}`/);
  });
});

describe('issues created in Jira/GitHub', () => {
  it.each([
    'imports/client/ui/module/module-details/module-dependencies/module-dependencies-aside.js',
    'imports/client/ui/module/module-details/module-detail-component.js',
    'imports/client/ui/module/module-details/module-detail-license.js'
  ])('%s marks them with the app name', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/TrustSource generated task/);
    expect(src).toMatch(/' \(' \+ Config\.name \+ ' generated task\)'/);
  });
});
