/* eslint-disable no-undef */
// HTML for reactive-table cells that must return markup (Spacebars.SafeString).
//
// Several list pages concatenated stored text straight into that markup: a
// scan's branch, tag and binary-link names (all free text from the scan API), an
// analysis version or release tag. A value like
// `<img src=x onerror=...>` then ran in the browser of every colleague who opened
// the page. These builders escape the text and keep the markup fixed.
const {
  escapeHtml,
  metaChip,
  externalLinkIcon
} = require('../../imports/lib/html/tableCells');

const MARKUP = '<img src=x onerror="alert(1)">';

describe('escapeHtml', () => {
  it('escapes text and attribute delimiters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('renders null and undefined as empty text', () => {
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });
});

describe('metaChip', () => {
  it('shows the icon and the text, with the text escaped', () => {
    const html = metaChip('fa-code-fork', 'Branch', MARKUP);
    expect(html).toBe('<span class="fa fa-code-fork inner-r-5" title="Branch"></span>' +
      '<span>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</span>');
    expect(html).not.toContain('<img');
  });
});

describe('externalLinkIcon', () => {
  it('links an http(s) address, quoted and escaped, opening safely', () => {
    expect(externalLinkIcon('https://example.test/doc?a=1&b="2"'))
      .toBe('<a href="https://example.test/doc?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">' +
        '<span class="fa fa-external-link"></span></a>');
  });

  it.each(['javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'data:text/html,<b>x</b>', 'x onmouseover=alert(1)', '', null])(
    'renders nothing for %p',
    (url) => {
      expect(externalLinkIcon(url)).toBe('');
    }
  );
});
