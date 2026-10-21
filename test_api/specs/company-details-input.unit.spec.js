/* eslint-disable no-undef */
// Input rules for the "Company details" form on the General info settings page
// (company name, company email, logo URL). The rules live in a dependency-free
// CommonJS module so the server method and this spec share one implementation.
//
// Contract: validateCompanyDetails(input) returns either {error} or {set, unset}.
// `set` holds the trimmed values to write, `unset` names the optional fields the
// caller cleared. Nothing else (billing, accountType, provisioning fields) can pass.
const {validateCompanyDetails} = require('../../imports/lib/companies/companyDetailsInput');

function ok(input) {
  const result = validateCompanyDetails(input);
  expect(result.error).toBeUndefined();
  return result;
}

function errorOf(input) {
  const result = validateCompanyDetails(input);
  expect(result.set).toBeUndefined();
  expect(result.unset).toBeUndefined();
  return result.error;
}

describe('validateCompanyDetails - input shape', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'Acme'],
    ['a number', 42],
    ['an array', [{name: 'Acme'}]],
    ['a date', new Date()],
    ['a class instance', new (class Details { constructor() { this.name = 'Acme'; } })()]
  ])('rejects %s', (_label, input) => {
    expect(errorOf(input)).toBe('Invalid company details');
  });

  it('accepts an object without a prototype', () => {
    const input = Object.create(null);
    input.name = 'Acme';
    expect(ok(input).set).toEqual({name: 'Acme'});
  });

  it.each(['billing', 'accountType', 'allowedLicenses', 'enterprise', 'apiKeys', 'logoBase64', 'name.first', '$set'])(
    'rejects the unknown field %p',
    (key) => {
      expect(errorOf({name: 'Acme', [key]: 'x'})).toBe('Unknown field: ' + key);
    }
  );

  it('rejects an own __proto__ key coming from parsed JSON', () => {
    const input = JSON.parse('{"name": "Acme", "__proto__": {"accountType": "enterprise"}}');
    expect(errorOf(input)).toBe('Unknown field: __proto__');
  });

  it('reports an unknown field before any value error', () => {
    expect(errorOf({billing: {}, name: ''})).toBe('Unknown field: billing');
  });

  it('returns exactly {set, unset} on success', () => {
    const result = ok({name: 'Acme', email: 'info@acme.io', logoUrl: 'https://acme.io/logo.png'});
    expect(result).toEqual({
      set: {name: 'Acme', email: 'info@acme.io', logoUrl: 'https://acme.io/logo.png'},
      unset: []
    });
  });
});

describe('validateCompanyDetails - name', () => {
  it.each([
    ['missing', {}],
    ['undefined', {name: undefined}],
    ['null', {name: null}],
    ['empty', {name: ''}],
    ['whitespace only', {name: '   \t '}],
    ['a number', {name: 42}],
    ['an object', {name: {$ne: null}}],
    ['an array', {name: ['Acme']}]
  ])('is required (%s)', (_label, input) => {
    expect(errorOf(input)).toBe('Company name is required');
  });

  it('is trimmed', () => {
    expect(ok({name: '  Acme GmbH  '}).set.name).toBe('Acme GmbH');
  });

  it('accepts a single character and exactly 200 characters', () => {
    expect(ok({name: 'A'}).set.name).toBe('A');
    expect(ok({name: 'a'.repeat(200)}).set.name).toHaveLength(200);
  });

  it('measures the length after trimming', () => {
    expect(ok({name: '  ' + 'a'.repeat(200) + '  '}).set.name).toHaveLength(200);
  });

  it('rejects 201 characters', () => {
    expect(errorOf({name: 'a'.repeat(201)})).toBe('Company name is too long');
  });

  // The company schema never allowed markup in a company name; the removed
  // Account & Billing form enforced that on the client. The server keeps it.
  it.each(['<b>Acme</b>', 'Acme > Co', 'Acme `Co`', 'javascript: Acme', 'Acme onload=1'])(
    'rejects markup-like characters in %p',
    (name) => {
      expect(errorOf({name})).toBe('Company name contains invalid characters');
    }
  );

  it('keeps ordinary punctuation', () => {
    expect(ok({name: 'Müller & Söhne (Berlin), Inc.'}).set.name).toBe('Müller & Söhne (Berlin), Inc.');
  });
});

describe('validateCompanyDetails - email', () => {
  it.each([
    ['missing', {name: 'Acme'}],
    ['undefined', {name: 'Acme', email: undefined}],
    ['null', {name: 'Acme', email: null}],
    ['empty', {name: 'Acme', email: ''}],
    ['whitespace only', {name: 'Acme', email: '  '}]
  ])('is unset when blank (%s)', (_label, input) => {
    const result = ok(input);
    expect('email' in result.set).toBe(false);
    expect(result.unset).toEqual(['email', 'logoUrl']);
  });

  it('is trimmed', () => {
    expect(ok({name: 'Acme', email: '  info@acme.io '}).set.email).toBe('info@acme.io');
  });

  it.each(['not-an-email', 'info@acme', '@acme.io', 'info@.io', 'in fo@acme.io', 'info@acme.io extra', 'a@b@c.io'])(
    'rejects %p',
    (email) => {
      expect(errorOf({name: 'Acme', email})).toBe('Invalid company email');
    }
  );

  it.each([
    ['a number', 42],
    ['an object', {$ne: null}],
    ['an array', ['info@acme.io']],
    ['a boolean', true]
  ])('rejects %s', (_label, email) => {
    expect(errorOf({name: 'Acme', email})).toBe('Invalid company email');
  });

  it('accepts exactly 254 characters and rejects 255', () => {
    const at254 = 'a'.repeat(254 - '@acme.io'.length) + '@acme.io';
    expect(at254).toHaveLength(254);
    expect(ok({name: 'Acme', email: at254}).set.email).toBe(at254);
    expect(errorOf({name: 'Acme', email: 'a' + at254})).toBe('Invalid company email');
  });
});

describe('validateCompanyDetails - logoUrl', () => {
  it.each([
    ['missing', {name: 'Acme'}],
    ['undefined', {name: 'Acme', logoUrl: undefined}],
    ['null', {name: 'Acme', logoUrl: null}],
    ['empty', {name: 'Acme', logoUrl: ''}],
    ['whitespace only', {name: 'Acme', logoUrl: ' \n '}]
  ])('is unset when blank (%s)', (_label, input) => {
    const result = ok(Object.assign({email: 'info@acme.io'}, input));
    expect('logoUrl' in result.set).toBe(false);
    expect(result.unset).toEqual(['logoUrl']);
  });

  it.each(['https://acme.io/logo.png', 'http://acme.io/logo.jpg', 'HTTPS://ACME.IO/LOGO.PNG', 'https://cdn.acme.io/a/b.png?v=2#x'])(
    'accepts %p',
    (logoUrl) => {
      expect(ok({name: 'Acme', logoUrl}).set.logoUrl).toBe(logoUrl);
    }
  );

  it('is trimmed', () => {
    expect(ok({name: 'Acme', logoUrl: '  https://acme.io/logo.png '}).set.logoUrl).toBe('https://acme.io/logo.png');
  });

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,iVBORw0KGgo=',
    'ftp://acme.io/logo.png',
    'file:///etc/passwd',
    '//acme.io/logo.png',
    'acme.io/logo.png',
    '/etc/logo.png',
    'https://',
    'https://acme.io/my logo.png'
  ])('rejects %p', (logoUrl) => {
    expect(errorOf({name: 'Acme', logoUrl})).toBe('Invalid logo URL');
  });

  it.each([
    ['a number', 42],
    ['an object', {href: 'https://acme.io/logo.png'}],
    ['an array', ['https://acme.io/logo.png']]
  ])('rejects %s', (_label, logoUrl) => {
    expect(errorOf({name: 'Acme', logoUrl})).toBe('Invalid logo URL');
  });

  it('accepts exactly 2000 characters and rejects 2001', () => {
    const prefix = 'https://acme.io/';
    const at2000 = prefix + 'a'.repeat(2000 - prefix.length);
    expect(at2000).toHaveLength(2000);
    expect(ok({name: 'Acme', logoUrl: at2000}).set.logoUrl).toBe(at2000);
    expect(errorOf({name: 'Acme', logoUrl: at2000 + 'a'})).toBe('Invalid logo URL');
  });
});

describe('validateCompanyDetails - set and unset together', () => {
  it('lists every cleared optional field and writes the rest', () => {
    expect(ok({name: ' Acme ', email: '', logoUrl: 'https://acme.io/logo.png'})).toEqual({
      set: {name: 'Acme', logoUrl: 'https://acme.io/logo.png'},
      unset: ['email']
    });
  });

  it('does not modify the input object', () => {
    const input = {name: '  Acme ', email: ' info@acme.io ', logoUrl: ''};
    const copy = JSON.parse(JSON.stringify(input));
    ok(input);
    expect(input).toEqual(copy);
  });
});
