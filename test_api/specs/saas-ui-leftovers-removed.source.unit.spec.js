/* eslint-disable no-undef */
// The Community Edition has no vendor support desk, help center, academy,
// newsletter, billing or SaaS legal pages. Problems are reported on the public
// repository (Config.supportUrl) and its README is the help (Config.helpUrl).
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function listFiles(dir, extensions) {
  const out = [];
  (function walk(current) {
    fs.readdirSync(current, {withFileTypes: true}).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith('.spec.js')) {
        out.push(path.relative(REPO, full));
      }
    });
  })(path.join(REPO, dir));
  return out;
}

const UI_FILES = listFiles('imports/client', ['.html', '.js'])
  .concat(listFiles('locales', ['.yml']));

describe('SaaS leftovers in the user interface', () => {
  it('points support at the public repository and help at the CE online help', () => {
    const config = read('imports/config.js');
    expect(config).toMatch(/supportUrl: 'https:\/\/github\.com\/TrustSource\/ts-core-ce\/issues'/);
    expect(config).toMatch(/helpUrl: 'https:\/\/help\.trustsource\.io\/ce\/'/);
  });

  it.each(UI_FILES)('%s has no vendor support, help, academy or legal link', (rel) => {
    const source = read(rel);
    expect(source).not.toMatch(/support@tr[a-z]*source\.io/i);
    expect(source).not.toMatch(/(support|help)\.trustsource\.io/);
    expect(source).not.toMatch(/trustsource\.io\/en\/academy/);
    expect(source).not.toMatch(/trustsource\.io\/(terms|AGB|dataprivacy|datenschutz)/);
    expect(source).not.toMatch(/Account & Billing/);
  });

  it('links the help icons to Config.helpUrl and drops the Trainings item', () => {
    expect(read('imports/client/ui/common/right-bar.html')).toMatch(/href="\{\{app 'helpUrl'\}\}"/);
    const navigation = read('imports/client/ui/common/navigation.js');
    expect(navigation).toMatch(/link: Config\.helpUrl/);
    expect(navigation).not.toMatch(/id: 'trainings'/);
  });

  it('links the "report an issue" hints to Config.supportUrl', () => {
    [
      'imports/client/ui/common/reactive-table-server-side/reactive-table-server-side.html',
      'imports/client/ui/module/module-details/module-tree/module-tree.html',
      'imports/client/ui/module/module-details/module-graphs/module-graphs.html',
      'imports/client/ui/check/check-license.html',
      'imports/client/ui/account/creatingWorkspace.html'
    ].forEach((rel) => {
      expect(read(rel)).toMatch(/href="\{\{app 'supportUrl'\}\}"/);
    });
  });

  it('registers without a terms checkbox or a newsletter opt-in', () => {
    const html = read('imports/client/ui/account/register.html');
    const js = read('imports/client/ui/account/register.js');
    expect(html).not.toMatch(/id="accept"|id="spam"/);
    expect(js).not.toMatch(/#accept|#spam|newsletter|NEWS_(GENERAL|PROMO|EACG)/);
    expect(js).not.toMatch(/accept:\s*\{/);
    expect(js).toMatch(/Accounts\.createUser\(newUser/);
  });

  it('offers no newsletter or promotional opt-ins on the profile page', () => {
    const html = read('imports/client/ui/settings/profile.html');
    expect(html).not.toMatch(/NEWS_(GENERAL|PROMO|EACG)/);
    expect(html).not.toMatch(/newsletter|promotional/i);
    expect(read('imports/client/ui/account/signup.html')).not.toMatch(/id="spam"/);
  });

  it('names the product by the app name on the dashboard banner', () => {
    expect(read('imports/client/ui/dashboard/dashboard.html')).toMatch(/\{\{__ 'WelcomeTo'\}\} \{\{app 'name'\}\}/);
    expect(read('locales/en.i18n.yml')).not.toMatch(/Welcome to TrustSource/);
  });
});

describe('Elastic Beanstalk settings shim', () => {
  it('is gone, together with its import', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/startup/server/beanstalk-fix.js'))).toBe(false);
    expect(read('imports/startup/server/index.js')).not.toMatch(/beanstalk/);
  });
});
