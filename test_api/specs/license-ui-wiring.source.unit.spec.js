/* eslint-disable no-undef */
// The license UI for company component managers, and the removal of the internal
// Legal management tooling. Blaze pages cannot render under Jest, so the wiring is
// locked on the source.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const UI = 'imports/client/ui/';

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

describe('Legal management is gone', () => {
  it('the legal-manager UI directory no longer exists', () => {
    expect(fs.existsSync(path.join(REPO, UI + 'legal-manager'))).toBe(false);
  });

  it('the client entry point no longer imports it', () => {
    expect(live('imports/startup/client/index.js')).not.toMatch(/ui\/legal-manager/);
  });

  it.each(["name: 'legalManagement'", "name: 'legalManagementDetail'"])('the router has no %s route', (token) => {
    expect(live('imports/lib/router.js')).not.toContain(token);
  });

  it('the navigation has no Legal mngr. menu', () => {
    const source = live(UI + 'common/navigation.js');
    expect(source).not.toMatch(/id: 'legal_manager'/);
    expect(source).not.toMatch(/route: 'legalManagement'/);
  });
});

describe('Add license', () => {
  const html = live(UI + 'license/license-create.html');
  const js = live(UI + 'license/license-create.js');

  it('is offered to the company component manager on the Licenses page', () => {
    expect(html).toMatch(/\{\{#if isInRole 'company_component_manager' companyId\}\}/);
    expect(live(UI + 'license/license-list.html')).toMatch(/\{\{> licenseCreate\}\}/);
  });

  it('submits through Licenses.Create', () => {
    expect(js).toMatch(/Meteor\.callAsync\('Licenses\.Create'/);
  });

  it('binds validation through document-delegated modal events, rebuilding with destroy()', () => {
    expect(js).toMatch(/\.on\('shown\.bs\.modal\.licenseCreate', '#createLicense'/);
    expect(js).toMatch(/existing\.destroy\(\)/);
    expect(js).not.toMatch(/removeData\(/);
    expect(js).not.toMatch(/'submit #createLicenseForm'/);
  });
});

describe('Edit license', () => {
  const html = live(UI + 'license/license-edit.html');
  const js = live(UI + 'license/license-edit.js');
  const router = live('imports/lib/router.js');

  it('saves through Licenses.Update and no longer uses AutoForm', () => {
    expect(js).toMatch(/Meteor\.callAsync\('Licenses\.Update'/);
    expect(js).not.toMatch(/AutoForm/);
    expect(html).not.toMatch(/autoForm|afQuickField|afArrayField/);
  });

  it('shows the key read-only', () => {
    expect(html).toMatch(/id="licenseEditKey"[^>]*readonly/);
  });

  it('is reached from the license detail page by the component manager', () => {
    const detail = live(UI + 'license/license-detail.html');
    expect(detail).toMatch(/\{\{#if isInRole 'company_component_manager' companyId\}\}\s*<a class="btn btn-default" href="\{\{pathFor 'licenseEdit' key=getKey\}\}"/);
  });

  it('the route sits under the license detail page', () => {
    const route = router.slice(router.indexOf("Router.route('/licenses/:key/edit'"), router.indexOf("Router.route('/cots_components'"));
    expect(route).toMatch(/parent: 'licenseDetail'/);
    expect(route).not.toMatch(/legalManagement/);
  });

  it('the route is gated on company_component_manager', () => {
    expect(router).toMatch(/requireRole\.call\(this, \['company_component_manager'\]\);\s*\}, \{\s*only: \[[^\]]*'licenseEdit'/);
  });

  it('the dataNotFound plugin renders the not-found template for a missing license key', () => {
    const start = router.indexOf("Router.plugin('dataNotFound'");
    expect(start).toBeGreaterThan(-1);
    const plugin = router.slice(start, router.indexOf('});', start) + 3);
    expect(plugin).toMatch(/only: \[[^\]]*'licenseEdit'[^\]]*\]/);
  });
});

describe('the license detail page shows no assessment state', () => {
  it.each([UI + 'license/license-detail.html', UI + 'license/license-detail.js'])('%s', (rel) => {
    const source = live(rel);
    expect(source).not.toMatch(/getLicenseStatus|getLicenseLabel|license-status-inline|analysed/);
  });
});
