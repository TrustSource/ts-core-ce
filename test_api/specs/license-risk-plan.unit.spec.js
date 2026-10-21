/* eslint-disable no-undef */
// The identity and the name of the Risk a manual license resolution
// files. Same shape as the SARIF planner: a generated value that
// overflows or trips collection2 fails deep inside the insert, and the feature
// then silently produces nothing.
const {
  LICENSE_RISK_AUTO_KEY_PREFIX,
  LICENSE_RISK_ORIGIN,
  UNSAFE_SEGMENT_LABEL,
  buildLicenseRiskAutoKey,
  buildLicenseRiskName,
  safeRiskNameSegment
} = require('../../imports/lib/licenseResolution/licenseRiskPlan');
const {AUTO_KEY_MAX, RISK_NAME_MAX, escapeKeySegment} =
  require('../../imports/lib/sarif/cweRiskPlan');

// RiskSchema.name's two anti-XSS regexes, verbatim. A name that fails either is
// rejected by collection2 INSIDE the insert.
// eslint-disable-next-line sonarjs/regex-complexity
const NAME_REGEXES = [/^[^<>]*$/,
  /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/];

function nameIsStorable(name) {
  return typeof name === 'string' && name.length >= 3 && name.length <= RISK_NAME_MAX &&
    NAME_REGEXES.every((re) => re.test(name));
}

describe('buildLicenseRiskAutoKey', () => {
  it('produces the documented key', () => {
    expect(buildLicenseRiskAutoKey('mod123', 'npm:left-pad'))
      .toBe('lic-unmatched|mod123|npm:left-pad');
    expect(LICENSE_RISK_AUTO_KEY_PREFIX).toBe('lic-unmatched');
  });

  it('is a deterministic function of the pair, and of nothing else (AC22)', () => {
    // Idempotency rests on this: a retried or concurrent call must land on the
    // same key so the unique partial index turns the loser into an update.
    expect(buildLicenseRiskAutoKey('m', 'k')).toBe(buildLicenseRiskAutoKey('m', 'k'));
    expect(buildLicenseRiskAutoKey('m', 'k')).not.toBe(buildLicenseRiskAutoKey('m2', 'k'));
    expect(buildLicenseRiskAutoKey('m', 'k')).not.toBe(buildLicenseRiskAutoKey('m', 'k2'));
  });

  it('cannot be made to collide across a segment boundary', () => {
    // A component key may legally contain `|` and `%` (it is scanner content),
    // so both are escaped in BOTH variable segments.
    expect(buildLicenseRiskAutoKey('a|b', 'c')).not.toBe(buildLicenseRiskAutoKey('a', 'b|c'));
    expect(buildLicenseRiskAutoKey('a', 'b|c')).toBe('lic-unmatched|a|b%7Cc');
    expect(buildLicenseRiskAutoKey('a', 'b%c')).toBe('lic-unmatched|a|b%25c');
    // `%` before `|`, or `a|b` and `a%7Cb` produce the same segment.
    expect(buildLicenseRiskAutoKey('a', 'b%7Cc')).not.toBe(buildLicenseRiskAutoKey('a', 'b|c'));
  });

  it('reuses the escape and the bound from cweRiskPlan rather than copying them', () => {
    expect(buildLicenseRiskAutoKey('a', 'b|c'))
      .toBe('lic-unmatched|' + escapeKeySegment('a') + '|' + escapeKeySegment('b|c'));
  });

  it('returns null rather than an unstorable key (AC22 -> risk "skipped")', () => {
    // Escaping can triple a segment, so the check is on the ASSEMBLED key.
    const long = buildLicenseRiskAutoKey('m', 'a'.repeat(AUTO_KEY_MAX));
    expect(long).toBeNull();
    const escaped = buildLicenseRiskAutoKey('m', '%'.repeat(120));
    expect(escaped).toBeNull();
  });

  it('accepts a key that lands exactly on the bound', () => {
    const fill = 'a'.repeat(AUTO_KEY_MAX - 'lic-unmatched|m|'.length);
    const key = buildLicenseRiskAutoKey('m', fill);
    expect(key).not.toBeNull();
    expect(key.length).toBe(AUTO_KEY_MAX);
  });

  it('returns null for anything that is not a non-empty string', () => {
    [undefined, null, '', 0, 7, {}, [], true].forEach((bad) => {
      expect(buildLicenseRiskAutoKey(bad, 'k')).toBeNull();
      expect(buildLicenseRiskAutoKey('m', bad)).toBeNull();
    });
  });
});

describe('safeRiskNameSegment', () => {
  it('leaves an ordinary component key and license key alone', () => {
    // `:` and `/` and `@` are all in the allow-list precisely because real keys
    // spell `npm:@scope/pkg`.
    expect(safeRiskNameSegment('npm:@angular/core')).toBe('npm:@angular/core');
    expect(safeRiskNameSegment('maven:org.apache.commons:commons-lang3'))
      .toBe('maven:org.apache.commons:commons-lang3');
    expect(safeRiskNameSegment('GPL-3.0-or-later')).toBe('GPL-3.0-or-later');
    expect(safeRiskNameSegment('BSD 3-Clause "New" License'.replace(/"/g, '')))
      .toBe('BSD 3-Clause New License');
  });

  it('strips the characters that would forge a CSV row or a spreadsheet formula', () => {
    // Company Logs is exported with `quotes: false`, and the same segment reaches
    // the audit message.
    expect(safeRiskNameSegment('a,b')).toBe('a b');
    expect(safeRiskNameSegment('a\nb')).toBe('a b');
    expect(safeRiskNameSegment('a\r\nb')).toBe('a b');
    expect(safeRiskNameSegment('=cmd()')).toBe('cmd()');
  });

  it('collapses the whitespace the strip leaves behind', () => {
    expect(safeRiskNameSegment('a,,,b')).toBe('a b');
    expect(safeRiskNameSegment('  a   b  ')).toBe('a b');
  });

  it('falls back for a segment the strip empties', () => {
    ['', '   ', ',,,', '<<<>>>', '`'].forEach((v) =>
      expect(safeRiskNameSegment(v)).toBe(UNSAFE_SEGMENT_LABEL));
  });

  it('falls back for a segment that survives the strip but still fails RiskSchema.name', () => {
    // THE case the char filter alone does not cover: `:` is in the allow-list
    // (real keys need it), so `javascript:` passes the filter and is then
    // rejected by the second regex - inside the insert, silently, forever.
    expect(safeRiskNameSegment('javascript:alert(1)')).toBe(UNSAFE_SEGMENT_LABEL);
    expect(safeRiskNameSegment('JavaScript : alert(1)')).toBe(UNSAFE_SEGMENT_LABEL);
  });

  it('always returns something RiskSchema.name will accept', () => {
    ['npm:left-pad', '<script>x</script>', 'javascript:x', 'onerror=alert(1)', '`x`',
      'a'.repeat(500), '', '   ', '你好', 'Проверка'].forEach((raw) => {
      const out = safeRiskNameSegment(raw);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
      NAME_REGEXES.forEach((re) => expect(re.test(out)).toBe(true));
    });
  });

  it('coerces non-strings rather than throwing', () => {
    [undefined, null, 0, 7, {}, []].forEach((v) =>
      expect(typeof safeRiskNameSegment(v)).toBe('string'));
  });
});

describe('buildLicenseRiskName', () => {
  it('produces the documented name', () => {
    expect(buildLicenseRiskName('npm:left-pad', 'MIT'))
      .toBe('[npm:left-pad] License set manually to MIT');
  });

  it('says "set manually", never "resolved" (design C3)', () => {
    // In this aside "Resolved" already means "a legal rule whose risk a manager
    // accepted". Reusing it would tell a compliance manager they accepted a risk.
    const name = buildLicenseRiskName('npm:a', 'MIT');
    expect(name).toContain('License set manually to');
    expect(name.toLowerCase()).not.toContain('resolved');
  });

  it('is a deterministic function of (componentKey, license) - AC24', () => {
    // The update branch only rewrites the name when the stored one still equals
    // buildLicenseRiskName(componentKey, storedAutoLicense), i.e. when nobody
    // renamed it. That test is only meaningful if the function is pure.
    expect(buildLicenseRiskName('k', 'MIT')).toBe(buildLicenseRiskName('k', 'MIT'));
  });

  it('is storable for a hostile component key (AC21 non-vacuity)', () => {
    // The markup characters are stripped rather than swapped for the fallback:
    // what remains is inert and still says which component it was about, which
    // is more use to a reader than "an unsupported value". The fallback is for
    // segments that cannot be made safe at all.
    const name = buildLicenseRiskName('<script>alert(1)</script>', 'MIT');
    expect(nameIsStorable(name)).toBe(true);
    expect(name).not.toMatch(/[<>`]/);
    expect(name).toContain('] License set manually to MIT');
  });

  it('is storable for a hostile license key', () => {
    expect(nameIsStorable(buildLicenseRiskName('npm:a', 'javascript:alert(1)'))).toBe(true);
  });

  it('never exceeds RiskSchema.name.max', () => {
    const name = buildLicenseRiskName('npm:' + 'a'.repeat(400), 'b'.repeat(200));
    expect(name.length).toBe(RISK_NAME_MAX);
    expect(nameIsStorable(name)).toBe(true);
  });

  it('stays storable across a sweep of real and adversarial inputs', () => {
    const keys = ['npm:left-pad', 'maven:org.x:y', 'pypi:requests', '', '   ',
      '<script>', 'javascript:x', 'a,b\nc', '=SUM(A1)', 'a'.repeat(300)];
    const licenses = ['MIT', 'GPL-3.0-or-later', 'PRIV KEY', '', '<b>', 'javascript:x',
      'x'.repeat(150)];
    keys.forEach((k) => licenses.forEach((l) =>
      expect(nameIsStorable(buildLicenseRiskName(k, l))).toBe(true)));
  });
});

describe('LICENSE_RISK_ORIGIN', () => {
  it('is the new enum member, not a reused one', () => {
    expect(LICENSE_RISK_ORIGIN).toBe('LIC');
  });

  it('is a member of the canonical origin enum (AC26)', () => {
    const {RISK_ORIGIN_VALUES} =
      require('../../imports/lib/interactors/riskProperties/riskOrigin');
    expect(RISK_ORIGIN_VALUES).toContain(LICENSE_RISK_ORIGIN);
  });
});

describe('the module stays requirable from both bundles', () => {
  const fs = require('fs');
  const path = require('path');
  const raw = fs.readFileSync(
    path.join(__dirname, '../../imports/lib/licenseResolution/licenseRiskPlan.js'), 'utf8');

  it('imports nothing from meteor/ and nothing server-only (AC27)', () => {
    expect(raw).not.toMatch(/require\(\s*['"]meteor\//);
    expect(raw).not.toMatch(/from\s+['"]meteor\//);
    expect(raw).not.toMatch(/imports\/server\//);
  });

  it('re-declares neither the escape nor the key bound', () => {
    expect(raw).toMatch(/require\(['"]\.\.\/sarif\/cweRiskPlan['"]\)/);
    expect(raw).not.toMatch(/function\s+escapeKeySegment/);
    expect(raw).not.toMatch(/AUTO_KEY_MAX\s*=/);
    expect(raw).not.toMatch(/RISK_NAME_MAX\s*=/);
  });
});
