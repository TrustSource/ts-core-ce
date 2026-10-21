/* eslint-disable no-undef */
// A new sign-up owns a company without a name. The sidebar points its account admin to
// Settings > General info, where the company name, email and logo are edited, until the
// company has a name.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '');
}

describe('company setup prompt in the sidebar', () => {
  const html = live('imports/client/ui/common/navigation.html');

  it('links to General info while the company has no name, for account admins only', () => {
    const prompt = html.match(
      /\{\{#if isInRole 'account_admin' companyId\}\}\s*\{\{#with company\}\}\s*\{\{#unless name\}\}([\s\S]*?)\{\{\/unless\}\}/);
    expect(prompt).not.toBeNull();
    expect(prompt[1]).toMatch(/class="nav-company-cta" href="\{\{pathFor route='companyGeneralInfo'\}\}"/);
    expect(prompt[1]).toMatch(/\{\{__ 'CompleteCompanySettings'\}\}/);
  });

  it('never points at the removed Account & Billing route', () => {
    expect(html).not.toMatch(/route='companySettings'/);
  });

  it('has its label and style', () => {
    expect(live('locales/en.i18n.yml')).toMatch(/^CompleteCompanySettings: Finish company setup$/m);
    expect(live('imports/client/stylesheets/common/navigation.less')).toMatch(/\.nav-company-cta \{/);
  });

  it('General info is the account admin page that edits the company name', () => {
    const router = live('imports/lib/router.js');
    expect(router).toMatch(/requireRole\.call\(this, \['account_admin'\]\);\s*\}, \{\s*only: \['companyGeneralInfo'\]/);
    expect(live('imports/client/ui/settings/account/company-general-info.html')).toMatch(/\{\{> companyDetailsForm\}\}/);
  });
});
