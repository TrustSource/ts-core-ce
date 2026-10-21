/* eslint-disable no-undef */
// Company details (name, email, logo URL) are edited on the General info settings page
// by an account admin, through the `Companies.UpdateDetails` method.
//
// Two layers:
//   - source assertions: the method is registered and rate-limited, the interactor checks the
//     role before it validates or writes, it never writes billing / account type / provisioning
//     fields, the logo fetch is bounded in time and size, and the form sits inside the
//     account_admin block of the General info page;
//   - behaviour: the real interactor, loaded with stubbed Meteor, Roles and Companies.
const fs = require('fs');
const path = require('path');
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');
const {validateCompanyDetails} = require('../../imports/lib/companies/companyDetailsInput');
const {logoDataUri, MAX_LOGO_BYTES} = require('../../imports/lib/companies/companyLogo');

const REPO = path.join(__dirname, '../..');
const INTERACTOR = 'imports/lib/interactors/companies/updateDetails.js';

// Handlebars comments are not JavaScript, so the template is stripped separately.
function liveTemplate(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
    .replace(/\{\{![\s\S]*?\}\}/g, '');
}

describe('Companies.UpdateDetails wiring', () => {
  it('is exported by the companies interactors and registered as a method', () => {
    expect(readSourceWithoutComments('imports/lib/interactors/companies/index.js'))
      .toMatch(/export \{default as CompaniesUpdateDetails\} from '\.\/updateDetails'/);
    const startup = readSourceWithoutComments('imports/startup/server/company.js');
    expect(startup).toMatch(/\bCompaniesUpdateDetails\b[\s\S]*\} from '\/imports\/lib\/interactors\/companies'/);
    expect(startup).toMatch(/'Companies\.UpdateDetails': CompaniesUpdateDetails/);
  });

  it('checks account_admin before it validates or writes', () => {
    // The method body only: the logo helper above it runs after a successful save.
    const whole = readSourceWithoutComments(INTERACTOR);
    const start = whole.indexOf('const updateDetails = async function');
    const end = whole.indexOf('export default updateDetails');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const src = whole.slice(start, end);
    const roleCheck = src.indexOf("'account_admin'");
    const validate = src.indexOf('validateCompanyDetails(');
    const write = src.indexOf('Companies.updateAsync(');
    expect(roleCheck).toBeGreaterThan(-1);
    expect(validate).toBeGreaterThan(roleCheck);
    expect(write).toBeGreaterThan(validate);
    expect(src).toMatch(/typeof companyId !== 'string'/);
  });

  it('never writes billing, account type or provisioning fields', () => {
    expect(readSourceWithoutComments(INTERACTOR)).not.toMatch(/\b(billing|accountType|allowedLicenses|enterprise)\b/);
  });

  it('fetches the logo only through the SSRF egress guard', () => {
    const src = readSourceWithoutComments(INTERACTOR);
    expect(src).toMatch(/httpCall\('GET', logoUrl, \{[^}]*validateEgress: true/);
    expect(src).toMatch(/logoDataUri\(/);
    // The unguarded image-to-base64 fetch (a collection hook that no longer fired on
    // Meteor 3) is gone, so there is exactly one way logoBase64 is derived.
    expect(readSourceWithoutComments('imports/server/collections/companies.js')).not.toMatch(/image2base64|image-to-base64/);
  });

  it('bounds the logo fetch to 10 seconds and the logo size cap', () => {
    const src = readSourceWithoutComments(INTERACTOR);
    expect(src).toMatch(/import \{[^}]*\bMAX_LOGO_BYTES\b[^}]*\} from '\/imports\/lib\/companies\/companyLogo'/);
    expect(src).toMatch(/httpCall\('GET', logoUrl, \{[^;]*timeoutMs: 10000[^;]*\}\)/);
    expect(src).toMatch(/httpCall\('GET', logoUrl, \{[^;]*maxBytes: MAX_LOGO_BYTES[^;]*\}\)/);
  });

  it('is rate-limited per connection and per user', () => {
    // Lift rate-limit.js with a recording DDPRateLimiter.
    const source = readSourceWithoutComments('imports/startup/server/rate-limit.js')
      .replace(/^import[\s\S]*?from\s*'[^']*';[ \t]*$/gm, '');
    const rules = [];
    new Function('DDPRateLimiter', source)({
      addRule(matcher, limit, interval) {
        rules.push({matcher, limit, interval});
      }
    });
    const matches = (matcher) => (typeof matcher.name === 'function'
      ? matcher.name('Companies.UpdateDetails') : matcher.name === 'Companies.UpdateDetails');
    const perConnection = rules.filter((r) => matches(r.matcher) && typeof r.matcher.connectionId === 'function');
    const perUser = rules.filter((r) => matches(r.matcher) && typeof r.matcher.userId === 'function');
    expect(perConnection.map((r) => [r.limit, r.interval])).toEqual([[5, 10 * 1000]]);
    expect(perUser.map((r) => [r.limit, r.interval])).toEqual([[10, 60 * 1000]]);
    expect(perUser[0].matcher.userId('user1')).toBe(true);
    expect(perConnection[0].matcher.connectionId('connection1')).toBe(true);
  });

  it('shows the form inside the account_admin block of General info, above the general settings', () => {
    const html = liveTemplate('imports/client/ui/settings/account/company-general-info.html');
    const block = html.match(/\{\{#if isInRole 'account_admin' companyId\}\}([\s\S]*?)\{\{\/if\}\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toContain('{{> companyDetailsForm}}');
    expect(block[1].indexOf('{{> companyDetailsForm}}')).toBeLessThan(block[1].indexOf('{{> companyGeneralSettingsForm}}'));
    expect(html.split('{{> companyDetailsForm}}')).toHaveLength(2);
  });

  it('loads the form template and calls the new method', () => {
    const index = readSourceWithoutComments('imports/client/ui/settings/account/index.js');
    expect(index).toContain("import './company-details-form.html';");
    expect(index).toContain("import './company-details-form';");
    const js = readSourceWithoutComments('imports/client/ui/settings/account/company-details-form.js');
    expect(js).toContain("'Companies.UpdateDetails'");
    expect(js).not.toMatch(/\bbilling\b|UpdateBilling/);
    expect(liveTemplate('imports/client/ui/settings/account/company-details-form.html'))
      .toMatch(/<template name="companyDetailsForm">/);
  });
});

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(`[${error}] ${reason}`);
    this.error = error;
    this.reason = reason;
  }
}

const ADMIN = {_id: 'admin1', profile: {companyId: 'companyA'}};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function load({user = ADMIN, isAdmin = true, updateCount = 1, logoResponse, logoError} = {}) {
  const updates = [];
  const userIsInRole = jest.fn(async () => isAdmin);
  const httpCall = jest.fn(async () => {
    if (logoError) throw logoError;
    return logoResponse || {statusCode: 200, content: PNG, headers: {'content-type': 'image/png'}};
  });
  const Companies = {
    updateAsync: jest.fn(async (selector, modifier) => {
      updates.push({selector, modifier});
      return updateCount;
    })
  };
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const mod = loadMeteorModule(INTERACTOR, {
    'meteor/meteor': {Meteor: {Error: FakeMeteorError, userAsync: jest.fn(async () => user)}},
    'meteor/alanning:roles': {Roles: {userIsInRole}},
    '/imports/lib/collections/companies': Companies,
    '/imports/lib/companies/companyDetailsInput': {validateCompanyDetails},
    '/imports/lib/companies/companyLogo': {logoDataUri, MAX_LOGO_BYTES},
    '/imports/lib/httpFetch': {httpCall}
  });
  return {updateDetails: mod.default, refreshCompanyLogo: mod.refreshCompanyLogo, updates, userIsInRole, httpCall, Companies, log};
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Companies.UpdateDetails behaviour', () => {
  const INPUT = {name: ' Acme ', email: 'info@acme.io', logoUrl: ''};

  it.each([
    ['no logged-in user', {user: null}, 'companyA'],
    ['a user without a company', {user: {_id: 'u', profile: {}}}, 'companyA'],
    ['another company id', {}, 'companyB'],
    ['a non-string company id', {}, {$ne: null}],
    ['a missing company id', {}, undefined],
    ['a user who is not account_admin', {isAdmin: false}, 'companyA']
  ])('refuses %s with 403 and writes nothing', async (_label, options, companyId) => {
    const {updateDetails, updates, httpCall} = load(options);
    await expect(updateDetails(companyId, INPUT)).rejects.toMatchObject({error: 403, reason: 'Access Denied'});
    expect(updates).toEqual([]);
    expect(httpCall).not.toHaveBeenCalled();
  });

  it('asks for account_admin in the caller\'s own company', async () => {
    const {updateDetails, userIsInRole} = load();
    await updateDetails('companyA', INPUT);
    expect(userIsInRole).toHaveBeenCalledWith(ADMIN, ['account_admin'], 'companyA');
  });

  it('refuses invalid input with 400 and writes nothing', async () => {
    const {updateDetails, updates} = load();
    await expect(updateDetails('companyA', {name: 'Acme', billing: {VAT: '1'}}))
      .rejects.toMatchObject({error: 400, reason: 'Unknown field: billing'});
    await expect(updateDetails('companyA', {name: ''}))
      .rejects.toMatchObject({error: 400, reason: 'Company name is required'});
    expect(updates).toEqual([]);
  });

  it('sets the trimmed values and unsets cleared fields, the derived logo with the logo URL', async () => {
    const {updateDetails, updates, httpCall} = load();
    await updateDetails('companyA', {name: ' Acme ', email: '', logoUrl: ' '});
    await flush();
    expect(updates).toEqual([{
      selector: 'companyA',
      modifier: {$set: {name: 'Acme'}, $unset: {email: true, logoUrl: true, logoBase64: true}}
    }]);
    expect(httpCall).not.toHaveBeenCalled();
  });

  it('leaves $unset out when nothing was cleared', async () => {
    const {updateDetails, updates} = load();
    await updateDetails('companyA', {name: 'Acme', email: 'info@acme.io', logoUrl: 'https://acme.io/logo.png'});
    expect(updates[0]).toEqual({
      selector: 'companyA',
      modifier: {$set: {name: 'Acme', email: 'info@acme.io', logoUrl: 'https://acme.io/logo.png'}}
    });
  });

  it('answers 500 when the company was not updated', async () => {
    const {updateDetails, httpCall} = load({updateCount: 0});
    await expect(updateDetails('companyA', {name: 'Acme', logoUrl: 'https://acme.io/logo.png'}))
      .rejects.toMatchObject({error: 500, reason: 'Could not update db'});
    await flush();
    expect(httpCall).not.toHaveBeenCalled();
  });

  it('derives logoBase64 from a new logo URL through the egress guard, only while that URL is current', async () => {
    const {updateDetails, updates, httpCall} = load();
    await updateDetails('companyA', {name: 'Acme', logoUrl: 'https://acme.io/logo.png'});
    await flush();
    expect(httpCall).toHaveBeenCalledWith('GET', 'https://acme.io/logo.png',
      {validateEgress: true, npmRequestOptions: {encoding: null}, timeoutMs: 10000, maxBytes: 512 * 1024});
    expect(updates[1]).toEqual({
      selector: {_id: 'companyA', logoUrl: 'https://acme.io/logo.png'},
      modifier: {$set: {logoBase64: 'data:image/png;base64,' + PNG.toString('base64')}}
    });
  });

  it('removes logoBase64 when the URL does not serve a PNG or JPEG', async () => {
    const {refreshCompanyLogo, updates} = load({
      logoResponse: {statusCode: 200, content: Buffer.from('<html></html>'), headers: {'content-type': 'image/png'}}
    });
    await refreshCompanyLogo('companyA', 'https://acme.io/logo.png');
    expect(updates).toEqual([{
      selector: {_id: 'companyA', logoUrl: 'https://acme.io/logo.png'},
      modifier: {$unset: {logoBase64: true}}
    }]);
  });

  it('removes logoBase64 when the fetch is blocked or fails, and does not reject', async () => {
    const blocked = Object.assign(new Error('Request blocked'), {code: 'SSRF_BLOCKED'});
    const {refreshCompanyLogo, updates, log} = load({logoError: blocked});
    await expect(refreshCompanyLogo('companyA', 'http://169.254.169.254/logo.png')).resolves.toBeUndefined();
    expect(updates).toEqual([{
      selector: {_id: 'companyA', logoUrl: 'http://169.254.169.254/logo.png'},
      modifier: {$unset: {logoBase64: true}}
    }]);
    expect(log).toHaveBeenCalled();
  });

  it('a failing logo refresh never fails the saved update', async () => {
    const {updateDetails, Companies, log} = load();
    Companies.updateAsync
      .mockImplementationOnce(async () => 1)
      .mockImplementationOnce(async () => { throw new Error('db down'); });
    await expect(updateDetails('companyA', {name: 'Acme', logoUrl: 'https://acme.io/logo.png'})).resolves.toBeUndefined();
    await flush();
    expect(Companies.updateAsync).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled();
  });
});
