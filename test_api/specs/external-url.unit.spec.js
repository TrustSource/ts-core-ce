// Issue #115: component links in the components lake only ever render http(s)
// targets. normalizeExternalUrl is meteor-free CommonJS so Jest can require it
// directly (same pattern as cvssImpact.js).
const {normalizeExternalUrl} = require('../../imports/lib/component/externalUrl');

describe('#115 normalizeExternalUrl', () => {
  it('keeps http(s) URLs as they are', () => {
    expect(normalizeExternalUrl('https://7-zip.org/')).toBe('https://7-zip.org/');
    expect(normalizeExternalUrl('http://www.7-zip.org/')).toBe('http://www.7-zip.org/');
  });

  it('rewrites the git remote spellings npm stores into browsable https URLs', () => {
    expect(normalizeExternalUrl('git+https://github.com/unshiftio/requests.git'))
      .toBe('https://github.com/unshiftio/requests.git');
    expect(normalizeExternalUrl('git+ssh://git@github.com/fritx/win-7zip.git'))
      .toBe('https://github.com/fritx/win-7zip.git');
    expect(normalizeExternalUrl('git://github.com/fritx/win-7zip.git'))
      .toBe('https://github.com/fritx/win-7zip.git');
  });

  it('drops anything that is not http(s) - package metadata is untrusted input', () => {
    expect(normalizeExternalUrl('javascript:alert(1)')).toBe('');
    expect(normalizeExternalUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(normalizeExternalUrl('//evil.example.com')).toBe('');
    expect(normalizeExternalUrl('mailto:someone@example.com')).toBe('');
    expect(normalizeExternalUrl('')).toBe('');
    expect(normalizeExternalUrl(null)).toBe('');
    expect(normalizeExternalUrl({href: 'https://example.com'})).toBe('');
  });
});
