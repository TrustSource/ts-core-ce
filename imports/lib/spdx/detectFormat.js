/**
 * Decide whether an SPDX import payload is RDF/XML or JSON.
 *
 * The format must be derived from the actual content, not just the file
 * extension or a request parameter: an SPDX document exported as RDF/XML must
 * always be parsed as RDF, even when the extension hint is missing or wrong
 * (which otherwise routes it to the JSON schema and fails - the RDF
 * export -> import round-trip).
 *
 * @param {string|object} data  raw file content (string) or already-parsed JSON (object)
 * @param {string} [extHint]    file extension fallback (e.g. 'rdf', 'xml', 'json', 'spdx')
 * @returns {'rdf'|'json'}
 */
export function detectSpdxFormat(data, extHint) {
  if (data && typeof data === 'object') {
    return 'json'; // already parsed as JSON
  }
  if (typeof data === 'string') {
    const s = data.trim(); // String.trim() also strips a leading BOM (U+FEFF)
    if (s.startsWith('<')) {
      return 'rdf'; // <?xml ...>, <rdf:RDF ...>, <spdx:...>
    }
    if (s.startsWith('{') || s.startsWith('[')) {
      return 'json';
    }
  }
  const ext = (extHint || '').toLowerCase();
  return (ext === 'rdf' || ext === 'xml') ? 'rdf' : 'json';
}

export default detectSpdxFormat;
