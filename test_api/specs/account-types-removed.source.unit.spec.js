/* eslint-disable no-undef */
// No account types, plans, trials or limits: nothing reads or writes them, and the
// Account & Billing page is gone.
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

const FILES = walk('imports', []);

describe('account types, plans, trials and limits are gone', () => {
  it.each([
    ['accountType', /\baccountType\b/],
    ['Plans collection', /\bPlans\b|collections\/plans/],
    ['trial', /\btrial\b|accountTrialNotice|UpdateTrial/i],
    ['limit methods', /isLimitReached|listOfReachedLimits|isFeatureLimitReachedByPlan|isSomeLimitsReachedByPlan|getParamsByCompany|getUserParams|getModuleComponentsCount/],
    ['limit banners', /LimitReached|limitReached/],
    ['account type update', /UpdateAccountType/],
    ['billing', /companyBilling|UpdateBilling|\bbilling\b/]
  ])('%s', (label, pattern) => {
    expect(FILES.filter((rel) => pattern.test(live(rel)))).toEqual([]);
  });

  it('plan files are deleted', () => {
    ['imports/lib/collections/plans.js', 'imports/lib/schemas/planSchema.js', 'imports/startup/server/limits.js',
      'imports/startup/server/plans.js'].forEach((rel) => expect(fs.existsSync(path.join(REPO, rel))).toBe(false));
  });

  it('the Account & Billing route and menu are gone', () => {
    expect(live('imports/lib/router.js')).not.toContain("name: 'companySettings'");
    expect(live('imports/client/ui/common/navigation.js')).not.toMatch(/Account & Billing/);
  });
});
