/* eslint-disable no-undef */
// The app authenticates API keys itself; nothing talks to AWS API Gateway, and
// there are no usage plans, quotas or usage charts.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '');
}

function walk(dir, out) {
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (entry.isFile() && /\.(js|html)$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

describe('no API Gateway coupling remains', () => {
  it.each([
    ['tsApigateway calls', /tsApigateway/],
    ['usage plans', /usagePlan|UsagePlan/],
    ['API usage', /getCompanyApiUsage|resolveApiUsageCompanyId|companyApiUsageOverallCharts|users\/usage/],
    ['API Gateway SDK', /client-api-gateway|APIGateway/],
    ['region setting', /TS_APIGATEWAY_REGION/]
  ])('%s', (label, pattern) => {
    const allowed = ['imports/server/security/companySecretFields.js'];
    const offenders = walk('imports', []).filter((rel) => allowed.indexOf(rel) === -1 && pattern.test(live(rel)));
    expect(offenders).toEqual([]);
  });

  it('the gateway module is deleted', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/startup/server/ts-apigateway.js'))).toBe(false);
  });
});
