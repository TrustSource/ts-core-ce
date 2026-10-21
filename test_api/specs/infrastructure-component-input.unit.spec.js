/* eslint-disable no-undef */
// InfrastructureComponents.Create is the only write path that adds an infrastructure
// component to the catalog every company on the install shares; these are its input rules.
const {
  validateInfrastructureComponentInput, normalizeInfrastructureComponentKey, sameValuePattern,
  INFRASTRUCTURE_COMPONENT_LIMITS
} = require('../../imports/lib/component/infrastructureComponentInput');

describe('validateInfrastructureComponentInput', () => {
  const VALID = {
    name: 'PostgreSQL',
    key: 'im:postgresql',
    versions: '16.4, 17.0',
    homepage: 'https://www.postgresql.org/',
    repository: 'https://github.com/postgres/postgres'
  };

  it('accepts a complete component', () => {
    expect(validateInfrastructureComponentInput(VALID)).toEqual({
      doc: {
        name: 'PostgreSQL',
        key: 'im:postgresql',
        versions: [{version: '16.4'}, {version: '17.0'}],
        urls: {homepage: 'https://www.postgresql.org/', repository: 'https://github.com/postgres/postgres'}
      }
    });
  });

  it('needs only a name, and leaves the key for the caller to derive', () => {
    expect(validateInfrastructureComponentInput({name: '  Redis  '})).toEqual({
      doc: {name: 'Redis', versions: [], urls: {}}
    });
  });

  it('refuses a missing, blank or non-string name', () => {
    [{}, {name: '   '}, {name: 42}].forEach((input) => {
      expect(validateInfrastructureComponentInput(input).error).toBe('Name is required');
    });
  });

  it('refuses a name that is too long', () => {
    const name = 'x'.repeat(INFRASTRUCTURE_COMPONENT_LIMITS.name + 1);
    expect(validateInfrastructureComponentInput({name}).error).toBe('Name is too long');
  });

  it('refuses anything that is not a plain object', () => {
    [null, 'name', ['name']].forEach((input) => {
      expect(validateInfrastructureComponentInput(input).error).toBe('Invalid component');
    });
  });

  it('refuses a field it does not know, so no other stored field can be written', () => {
    expect(validateInfrastructureComponentInput({name: 'Redis', removed: true}).error)
      .toBe('Unknown field: removed');
  });

  it('drops blank versions and repeats, so an empty field saves no version', () => {
    expect(validateInfrastructureComponentInput({name: 'Redis', versions: ''}).doc.versions).toEqual([]);
    expect(validateInfrastructureComponentInput({name: 'Redis', versions: ' 7.2, ,7.2 ,8.0,'}).doc.versions)
      .toEqual([{version: '7.2'}, {version: '8.0'}]);
  });

  it('refuses versions that are not a string, too long or too many', () => {
    expect(validateInfrastructureComponentInput({name: 'Redis', versions: ['7.2']}).error)
      .toBe('Invalid versions');
    const longVersion = 'v'.repeat(INFRASTRUCTURE_COMPONENT_LIMITS.version + 1);
    expect(validateInfrastructureComponentInput({name: 'Redis', versions: longVersion}).error)
      .toBe('A version is too long');
    const many = Array.from({length: INFRASTRUCTURE_COMPONENT_LIMITS.versionCount + 1}, (v, i) => '1.' + i).join(',');
    expect(validateInfrastructureComponentInput({name: 'Redis', versions: many}).error)
      .toBe('Too many versions');
  });

  it('accepts only http(s) links for homepage and repository', () => {
    ['javascript:alert(1)', 'ftp://example.org', 'https://exa mple.org', 42].forEach((url) => {
      expect(validateInfrastructureComponentInput({name: 'Redis', homepage: url}).error)
        .toBe('Invalid homepage URL');
      expect(validateInfrastructureComponentInput({name: 'Redis', repository: url}).error)
        .toBe('Invalid repository URL');
    });
    expect(validateInfrastructureComponentInput({name: 'Redis', homepage: ' ', repository: null}).doc.urls)
      .toEqual({});
  });

  it('normalizes and checks a key the caller gave', () => {
    expect(validateInfrastructureComponentInput({name: 'MySQL', key: ' MySQL '}).doc.key).toBe('im:mysql');
    expect(validateInfrastructureComponentInput({name: 'MySQL', key: 'my sql'}).error).toBe('Invalid key');
  });
});

describe('normalizeInfrastructureComponentKey', () => {
  it('lowercases and adds the im: prefix when it is missing', () => {
    expect(normalizeInfrastructureComponentKey('im:Apache_Kafka')).toEqual({value: 'im:apache_kafka'});
    expect(normalizeInfrastructureComponentKey('nginx')).toEqual({value: 'im:nginx'});
  });

  it('refuses a key with whitespace, a bare prefix, or one that is too long', () => {
    ['im:my db', 'im:', '   ', 42, 'im:' + 'k'.repeat(INFRASTRUCTURE_COMPONENT_LIMITS.key)].forEach((key) => {
      expect(normalizeInfrastructureComponentKey(key)).toEqual({error: 'Invalid key'});
    });
  });
});

describe('sameValuePattern', () => {
  it('matches the whole value ignoring case, with regex characters taken literally', () => {
    const pattern = sameValuePattern('im:c++ (lib).*');
    expect(pattern.test('IM:C++ (LIB).*')).toBe(true);
    expect(pattern.test('im:c++ (lib).*x')).toBe(false);
    expect(pattern.test('im:cc (lib)ab')).toBe(false);
  });
});
