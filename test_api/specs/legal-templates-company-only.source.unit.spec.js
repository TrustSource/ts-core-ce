/* eslint-disable no-undef */
// System-wide (company-less) legal settings templates were EACG-curated presets
// managed by the internal legal_manager role. The Community Edition has only the
// company's own templates, managed under Settings by the account admin.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const server = live('imports/server/collections/legalSettingsTemplates.js');

function publication(name) {
  const start = server.indexOf(`Meteor.publish('${name}'`);
  expect(start).toBeGreaterThan(-1);
  const next = server.indexOf('Meteor.publish(', start + 1);
  const allow = server.indexOf('LegalSettingsTemplates.allow(', start);
  const ends = [next, allow].filter((i) => i > -1);
  return server.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('the system-wide template tooling is gone', () => {
  it('the pages, their client import and their routes are deleted', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/client/ui/legal-settings-templates'))).toBe(false);
    expect(live('imports/startup/client/index.js')).not.toMatch(/ui\/legal-settings-templates/);
    const router = live('imports/lib/router.js');
    expect(router).not.toContain("name: 'legalSettingsTemplates'");
    expect(router).not.toContain("name: 'legalSettingsTemplatesDetails'");
    expect(router).not.toMatch(/subscribe\('legalSettingsTemplates'\)/);
  });

  it('the global publication and the global update method are gone', () => {
    expect(server).not.toMatch(/Meteor\.publish\('legalSettingsTemplates'/);
    expect(server).not.toMatch(/_updateLegalSettingsTemplate:/);
  });
});

describe('only company templates reach a user', () => {
  it.each(['availableLegalSettingsTemplates', 'legalSettingsTemplateDetail'])('%s never offers a company-less template', (name) => {
    const pub = publication(name);
    expect(pub).not.toMatch(/\$exists: ?false/);
    expect(pub).toMatch(/companyId: companyId/);
  });

  it('companyLegalSettingsTemplates returns this.ready() before finding, when companyId is missing', () => {
    const pub = publication('companyLegalSettingsTemplates');
    expect(pub).toMatch(/companyId: companyId/);
    const readyAt = pub.indexOf('if (!companyId)');
    expect(readyAt).toBeGreaterThan(-1);
    const findAt = pub.indexOf('LegalSettingsTemplates.find(');
    expect(findAt).toBeGreaterThan(-1);
    expect(readyAt).toBeLessThan(findAt);
    expect(pub.slice(readyAt, findAt)).toMatch(/return this\.ready\(\);/);
  });
});

describe('only company templates can be written', () => {
  it('the allow rules deny a company-less document', () => {
    const allow = server.slice(server.indexOf('async function isCompanyTemplateAdmin'), server.indexOf('Meteor.methods('));
    expect(allow).toMatch(/if \(!userId \|\| !doc \|\| !doc\.companyId\) \{\s*return false;/);
    ['insert', 'remove'].forEach((rule) =>
      expect(allow).toMatch(new RegExp(rule + ': async function \\(userId, doc\\) \\{\\s*return await isCompanyTemplateAdmin\\(userId, doc\\);')));
  });

  it('the update allow rule refuses a modifier touching companyId', () => {
    const allow = server.slice(server.indexOf('async function isCompanyTemplateAdmin'), server.indexOf('Meteor.methods('));
    expect(allow).toMatch(/update: async function \(userId, doc, fieldNames\) \{[\s\S]*?fieldNames\.indexOf\('companyId'\) !== -1[\s\S]*?return false;/);
  });

  it('the remove interactor refuses a company-less template', () => {
    const remove = live('imports/lib/interactors/legalSettingsTemplates/remove.js');
    expect(remove).toMatch(/if \(!template\.companyId \|\| template\.companyId !== companyId/);
    expect(remove).not.toMatch(/legal_manager/);
  });

  it('_updateCompanyLegalSettingsTemplate refuses companyId in its $set', () => {
    const start = server.indexOf('_updateCompanyLegalSettingsTemplate:');
    const method = server.slice(start, server.indexOf('}\n});', start));
    expect(method).toMatch(/companyId\./);
    expect(method).toMatch(/403, AD/);
    expect(method).not.toContain('const companyId = user.profile.companyId;');
    const companyIdRefusalIndex = method.search(/companyId\./);
    const updateCallIndex = method.indexOf('LegalSettingsTemplates.updateAsync(');
    expect(updateCallIndex).toBeGreaterThan(-1);
    expect(companyIdRefusalIndex).toBeLessThan(updateCallIndex);
  });
});
