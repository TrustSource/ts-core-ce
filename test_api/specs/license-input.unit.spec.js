/* eslint-disable no-undef */
// Licenses.Create and Licenses.Update are the only write path to the shared license
// catalog. These rules decide what a DDP client may store.
const {
  validateLicenseInput,
  sameKeyPattern,
  LICENSE_EDITOR_ROLES,
  DUPLICATE_KEY_MESSAGE,
  LICENSE_INPUT_LIMITS,
  findIdentifierClash,
  identifierClashMessage
} = require('../../imports/lib/licenses/licenseInput');

const VALID = {key: 'MIT', name: 'MIT License', url: 'https://opensource.org/licenses/MIT', text: 'Permission is hereby granted'};

function create(overrides) {
  return validateLicenseInput(Object.assign({}, VALID, overrides), 'create');
}

function update(input) {
  return validateLicenseInput(input, 'update');
}

describe('constants', () => {
  it('lets only the company component manager edit the catalog', () => {
    expect(LICENSE_EDITOR_ROLES).toEqual(['company_component_manager']);
  });

  it('names the duplicate key refusal', () => {
    expect(DUPLICATE_KEY_MESSAGE).toBe('A license with this key already exists');
  });

  it('pins the limits from the spec', () => {
    expect(LICENSE_INPUT_LIMITS).toEqual({
      key: 100, name: 200, url: 2000, aliasLength: 200, aliasCount: 50, text: 256 * 1024, copyright: 2000
    });
  });
});

describe('shape', () => {
  it.each([null, undefined, 'MIT', 42, [], ['MIT']])('refuses a non-object input %p', (input) => {
    expect(validateLicenseInput(input, 'create')).toEqual({error: 'Invalid license'});
  });

  it('refuses an unknown field on create', () => {
    expect(create({constraints: {}})).toEqual({error: 'Unknown field: constraints'});
  });

  it.each(['key', 'analysed', 'created', '_id', 'editorial'])('refuses %s on update', (field) => {
    expect(update({name: 'MIT License', [field]: 'x'})).toEqual({error: 'Unknown field: ' + field});
  });
});

describe('key (create only)', () => {
  it('accepts SPDX-style keys and trims them', () => {
    ['MIT', 'Apache-2.0', 'GPL-2.0-or-later', 'GPL-2.0+', 'LicenseRef-acme.1'].forEach((key) => {
      expect(create({key: '  ' + key + ' '}).doc.key).toBe(key);
    });
  });

  it.each([undefined, null, '', '   ', 7])('requires a key (%p)', (key) => {
    expect(create({key}).error).toBe('License key is required');
  });

  it.each(['-MIT', '.MIT', 'MIT License', 'MIT/2', 'M$T', 'MIT_2'])('refuses the key %p', (key) => {
    expect(create({key}).error).toMatch(/^License key may only contain/);
  });

  it('refuses a key over 100 characters', () => {
    expect(create({key: 'A'.repeat(101)}).error).toBe('License key is too long');
    expect(create({key: 'A'.repeat(100)}).doc.key).toHaveLength(100);
  });
});

describe('name', () => {
  it('is required and trimmed', () => {
    expect(create({name: '  MIT License '}).doc.name).toBe('MIT License');
    expect(create({name: ''}).error).toBe('License name is required');
    expect(create({name: undefined}).error).toBe('License name is required');
    expect(update({}).error).toBe('License name is required');
  });

  it('is at most 200 characters', () => {
    expect(create({name: 'n'.repeat(201)}).error).toBe('License name is too long');
  });
});

describe('url', () => {
  it('accepts http and https, trimmed', () => {
    expect(create({url: ' http://example.com/l '}).doc.url).toBe('http://example.com/l');
  });

  it.each(['javascript:alert(1)', 'ftp://example.com', 'example.com', 'https://exa mple.com', 42])(
    'refuses %p', (url) => {
      expect(create({url}).error).toBe('Invalid URL');
    });

  it('refuses one over 2000 characters', () => {
    expect(create({url: 'https://e.com/' + 'a'.repeat(2000)}).error).toBe('Invalid URL');
  });

  it('is cleared when omitted or empty', () => {
    const result = create({url: '  '});
    expect(result.doc.url).toBeUndefined();
    expect(result.cleared).toContain('url');
    expect(update({name: 'x'}).cleared).toContain('url');
  });
});

describe('aliases', () => {
  it('trims, drops empties and de-duplicates in order', () => {
    expect(create({aliases: [' MIT ', '', 'Expat', 'MIT', '  ']}).doc.aliases).toEqual(['MIT', 'Expat']);
  });

  it('is cleared when omitted or empty after trimming', () => {
    expect(create({aliases: ['', ' ']}).cleared).toContain('aliases');
    expect(create({}).cleared).toContain('aliases');
  });

  it.each(['MIT', {0: 'MIT'}, [42], [null]])('refuses %p', (aliases) => {
    expect(create({aliases}).error).toBe('Invalid aliases');
  });

  it('bounds each alias and the count', () => {
    expect(create({aliases: ['a'.repeat(201)]}).error).toBe('An alias is too long');
    const many = Array.from({length: 51}, (_, i) => 'alias' + i);
    expect(create({aliases: many}).error).toBe('Too many aliases');
    expect(create({aliases: many.slice(0, 50)}).doc.aliases).toHaveLength(50);
  });

  it('rejects raw array exceeding the count limit before iterating', () => {
    expect(create({aliases: ['MIT'].concat(Array(50).fill(''))}).error).toBe('Too many aliases');
  });

  it('rejects very large arrays efficiently', () => {
    expect(create({aliases: Array(10000).fill('test')}).error).toBe('Too many aliases');
  });
});

describe('text', () => {
  it('is stored untrimmed', () => {
    expect(create({text: '  line one\nline two\n'}).doc.text).toBe('  line one\nline two\n');
  });

  it('is cleared when omitted or blank', () => {
    expect(create({text: ' \n '}).cleared).toContain('text');
  });

  it('refuses a non-string and anything over 256 KB', () => {
    expect(create({text: 5}).error).toBe('Invalid license text');
    expect(create({text: 'x'.repeat(256 * 1024 + 1)}).error).toBe('License text is too long');
    expect(create({text: 'x'.repeat(256 * 1024)}).doc.text).toHaveLength(256 * 1024);
  });
});

describe('copyright', () => {
  it('is trimmed, bounded and cleared when empty', () => {
    expect(create({copyright: ' (c) Someone '}).doc.copyright).toBe('(c) Someone');
    expect(create({copyright: 'c'.repeat(2001)}).error).toBe('Copyright is too long');
    expect(create({copyright: {}}).error).toBe('Invalid copyright');
    expect(create({copyright: ''}).cleared).toContain('copyright');
  });
});

describe('results', () => {
  it('a full create returns only stored fields', () => {
    const result = create({aliases: ['Expat'], copyright: '(c)'});
    expect(result.error).toBeUndefined();
    expect(result.doc).toEqual({
      key: 'MIT', name: 'MIT License', url: 'https://opensource.org/licenses/MIT',
      aliases: ['Expat'], text: 'Permission is hereby granted', copyright: '(c)'
    });
    expect(result.cleared).toEqual([]);
  });

  it('an update never carries a key', () => {
    const result = update({name: 'MIT License', url: '', aliases: [], text: 'T', copyright: ''});
    expect(result.doc).toEqual({name: 'MIT License', text: 'T'});
    expect(result.cleared.sort()).toEqual(['aliases', 'copyright', 'url']);
  });
});

describe('sameKeyPattern', () => {
  it('matches the same key in any case and nothing else', () => {
    const pattern = sameKeyPattern('GPL-2.0+');
    expect(pattern.test('gpl-2.0+')).toBe(true);
    expect(pattern.test('GPL-2.0+')).toBe(true);
    expect(pattern.test('GPL-2X0+')).toBe(false);
    expect(pattern.test('GPL-2.0++')).toBe(false);
    expect(pattern.test('xGPL-2.0+')).toBe(false);
  });
});

describe('findIdentifierClash', () => {
  it('finds no clash against an empty list', () => {
    expect(findIdentifierClash({key: 'MIT', name: 'MIT License', aliases: ['Expat']}, [])).toBeNull();
  });

  it('finds no clash against unrelated licenses', () => {
    const others = [
      {key: 'Apache-2.0', name: 'Apache License 2.0', aliases: ['Apache2']},
      {key: 'ISC', name: 'ISC License', aliases: []}
    ];
    expect(findIdentifierClash({key: 'MIT', name: 'MIT License', aliases: ['Expat']}, others)).toBeNull();
  });

  it('clashes when the candidate name equals another license key, ignoring case', () => {
    const others = [{key: 'MIT', name: 'MIT License', aliases: []}];
    const clash = findIdentifierClash({key: 'X-1', name: 'mit', aliases: []}, others);
    expect(clash).toEqual({value: 'mit', key: 'MIT'});
  });

  it('clashes when a candidate alias equals another license name', () => {
    const others = [{key: 'X-1', name: 'Something Else', aliases: []}];
    const clash = findIdentifierClash({key: 'X-2', name: 'Y', aliases: ['Something Else']}, others);
    expect(clash).toEqual({value: 'Something Else', key: 'X-1'});
  });

  it('clashes when the candidate key equals another license alias', () => {
    const others = [{key: 'X-1', name: 'Other', aliases: ['DupKey']}];
    const clash = findIdentifierClash({key: 'DupKey', name: 'Y', aliases: []}, others);
    expect(clash).toEqual({value: 'DupKey', key: 'X-1'});
  });

  it('skips non-string entries in others without throwing', () => {
    const others = [{key: null, name: 'Other', aliases: null}, {key: 'X-2', name: 'Z', aliases: [42]}];
    expect(() => findIdentifierClash({key: 'MIT', name: 'MIT License', aliases: []}, others)).not.toThrow();
    expect(findIdentifierClash({key: 'MIT', name: 'MIT License', aliases: []}, others)).toBeNull();
  });

  it('identifierClashMessage formats the refusal', () => {
    expect(identifierClashMessage({value: 'MIT', key: 'X-1'})).toBe('"MIT" is already used by license X-1');
  });
});
