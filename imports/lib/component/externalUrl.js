// Component homepage/repository links shown in the components lake.
//
// CommonJS with no meteor/* imports so Jest can require it directly - the same
// dual-consumption pattern as cvssImpact.js.

const HTTP_URL = /^https?:\/\//i;

// Component URLs come from scanned package metadata, so they are untrusted: only
// http(s) targets are ever handed to the view, which keeps `javascript:`/`data:`
// hrefs out. npm stores git remotes rather than browsable pages, so the common
// git spellings are rewritten to https instead of being dropped.
function normalizeExternalUrl(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  let url = value.trim();
  if (!url) {
    return '';
  }
  url = url.replace(/^git\+/i, '');
  url = url.replace(/^(?:git|ssh):\/\/(?:[^@/]+@)?/i, 'https://');
  return HTTP_URL.test(url) ? url : '';
}

module.exports = {
  normalizeExternalUrl
};
