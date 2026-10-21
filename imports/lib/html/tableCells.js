// Markup for reactive-table cells that return HTML (Spacebars.SafeString).
//
// Stored text - a scan's branch, tag and binary-link names, an analysis version
// or release tag, a legal document link - used to
// be concatenated into that markup as-is, so markup in the text ran in the
// browser of everyone who opened the page. These builders keep the markup fixed
// and escape every piece of text.
//
// CommonJS with no meteor/* imports so Jest can require it directly; the client
// imports it like any other shared module.

// Text and attribute contexts (double- and single-quoted).
function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// An icon followed by a piece of text, e.g. a scan's branch. `icon` and `title`
// are fixed by the caller; only `text` comes from stored data.
function metaChip(icon, title, text) {
  return `<span class="fa ${icon} inner-r-5" title="${title}"></span><span>${escapeHtml(text)}</span>`;
}

// An external-link icon for an http(s) address; anything else (javascript:,
// data:, attribute fragments) renders nothing.
function externalLinkIcon(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    return '';
  }
  return `<a href="${escapeHtml(url.trim())}" target="_blank" rel="noopener noreferrer">` +
    '<span class="fa fa-external-link"></span></a>';
}

module.exports = {escapeHtml, metaChip, externalLinkIcon};
