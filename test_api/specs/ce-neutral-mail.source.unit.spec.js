/* eslint-disable no-undef */
// Outgoing mails of a self-hosted installation carry no vendor identity (#191).
// They name the app and its address, plus the operator details the
// administrator chose to set (TS_OPERATOR_NAME, TS_SUPPORT_EMAIL, TS_IMPRINT_URL).
// The mail code runs inside Meteor, which Jest does not load, so the markup is
// checked through the pure builder and the call sites at source level.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const {buildMailFooter, buildSupportContact} = require('../../imports/server/mail/footerHtml');

const MAIL_CODE = [
  'imports/server/mail/footer.js',
  'imports/server/mail/footerHtml.js',
  'imports/lib/utils.js',
  'imports/server/collections/users.js',
  'imports/server/collections/modules.js',
  'imports/startup/server/accounts.js',
  'imports/startup/server/email.js',
  'imports/startup/server/jira.js',
  'imports/lib/interactors/vulnerabilityAlerts/evaluateProject.js'
];

describe('server mail code carries no vendor identity', () => {
  it.each(MAIL_CODE)('%s names no vendor address, company or register entry', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/trustsource\.io/i);
    expect(src).not.toMatch(/EACG Operations/);
    expect(src).not.toMatch(/Taunustor|TaunusTurm/);
    expect(src).not.toMatch(/\bHRB\b/);
    expect(src).not.toMatch(/eacg\.de/i);
    expect(src).not.toMatch(/Gesch&auml;ftsf&uuml;hrer/);
  });

  it('the shared Utils no longer builds a mail footer', () => {
    expect(read('imports/lib/utils.js')).not.toMatch(/getMailFooter/);
  });

  it('no file still calls Utils.getMailFooter', () => {
    for (const file of ['imports/server/collections/users.js', 'imports/server/collections/modules.js',
      'imports/startup/server/accounts.js']) {
      const src = read(file);
      expect(src).not.toMatch(/getMailFooter/);
      expect(src).toMatch(/import \{mailFooter(, supportContact)?\} from '\/imports\/server\/mail\/footer';/);
      expect(src).toMatch(/mailFooter\(\)/);
    }
  });
});

describe('mail footer', () => {
  const base = {appName: 'TrustSource CE', appUrl: 'https://ts.example.org/'};

  it('names only the app and its address when no operator detail is set', () => {
    const html = buildMailFooter(base);
    expect(html).toContain('This message was sent by TrustSource CE at ' +
      '<a href="https://ts.example.org/">https://ts.example.org/</a>.');
    expect(html).not.toMatch(/Operated by|Questions\?|Imprint/);
  });

  it('adds each operator line only when that setting is set', () => {
    expect(buildMailFooter({...base, operatorName: 'Example Ltd'})).toContain('<p>Operated by Example Ltd</p>');
    expect(buildMailFooter({...base, operatorName: 'Example Ltd'})).not.toMatch(/Questions\?|Imprint/);

    const support = buildMailFooter({...base, supportEmail: 'help@example.org'});
    expect(support).toContain('<p>Questions? Contact <a href="mailto:help@example.org">help@example.org</a></p>');
    expect(support).not.toMatch(/Operated by|Imprint/);

    const imprint = buildMailFooter({...base, imprintUrl: 'https://example.org/imprint'});
    expect(imprint).toContain('<p><a href="https://example.org/imprint">Imprint</a></p>');
    expect(imprint).not.toMatch(/Operated by|Questions\?/);
  });

  it('treats empty and whitespace-only settings as unset', () => {
    const html = buildMailFooter({...base, operatorName: '', supportEmail: '  ', imprintUrl: undefined});
    expect(html).toBe(buildMailFooter(base));
  });

  it('escapes every setting value', () => {
    const html = buildMailFooter({
      appName: 'TrustSource CE',
      appUrl: 'https://ts.example.org/?a=1&b="2"',
      operatorName: '<script>alert(1)</script> & Co',
      supportEmail: 'a"b@example.org',
      imprintUrl: 'https://example.org/imprint?x="><img src=x>'
    });
    expect(html).not.toMatch(/<script>|<img/);
    expect(html).toContain('Operated by &lt;script&gt;alert(1)&lt;/script&gt; &amp; Co');
    expect(html).toContain('href="https://ts.example.org/?a=1&amp;b=&quot;2&quot;"');
    expect(html).toContain('href="mailto:a&quot;b@example.org"');
    expect(html).toContain('href="https://example.org/imprint?x=&quot;&gt;&lt;img src=x&gt;"');
  });

  it('links an imprint only when it is an http(s) address', () => {
    expect(buildMailFooter({...base, imprintUrl: 'javascript:alert(1)'})).not.toMatch(/Imprint|javascript/);
  });
});

describe('support contact phrase in account mails', () => {
  it('names the support address when set', () => {
    expect(buildSupportContact('help@example.org'))
      .toBe('contact <a href="mailto:help@example.org">help@example.org</a>');
  });

  it('falls back to the administrator when unset', () => {
    expect(buildSupportContact(undefined)).toBe('contact your administrator');
    expect(buildSupportContact('   ')).toBe('contact your administrator');
  });

  it('escapes the address', () => {
    expect(buildSupportContact('<b>@x')).toBe('contact <a href="mailto:&lt;b&gt;@x">&lt;b&gt;@x</a>');
  });
});

describe('account mails', () => {
  const src = read('imports/startup/server/accounts.js');

  it('use the app name as site name', () => {
    expect(src).toMatch(/Accounts\.emailTemplates\.siteName = AppConfig\.name;/);
  });

  it('point a recipient who did not ask for the mail at the support contact', () => {
    expect(src.match(/If you did not request this, please ' \+ supportContact\(\)/g)).toHaveLength(2);
  });

  it('cite no vendor terms', () => {
    expect(src).not.toMatch(/terms and conditions|AGB/);
  });
});

describe('vulnerability alert sweep actor', () => {
  const src = read('imports/lib/interactors/vulnerabilityAlerts/evaluateProject.js');

  it('is named after the app and uses a non-routable address', () => {
    expect(src).toMatch(/const SWEEP_ACTOR_NAME = `\$\{AppConfig\.name\} vulnerability alerts`;/);
    expect(src).toMatch(/const SWEEP_ACTOR_EMAIL = 'system@localhost';/);
  });
});

describe('reply-to allowlist', () => {
  it('allows only the configured support address', () => {
    const src = read('imports/startup/server/email.js');
    expect(src).not.toMatch(/REPLY_TO_ALLOWLIST/);
    expect(src).toMatch(/replyTo !== Config\.TS_SUPPORT_EMAIL/);
  });
});

describe('operator mail settings are documented', () => {
  it.each(['TS_OPERATOR_NAME', 'TS_SUPPORT_EMAIL', 'TS_IMPRINT_URL'])('%s', (name) => {
    expect(read('docker-compose.yml')).toContain(`- ${name}=\${${name}:-}`);
    expect(read('.env.example')).toMatch(new RegExp(`^#${name}=`, 'm'));
    expect(read('Readme.md')).toContain(`\`${name}\``);
  });
});
