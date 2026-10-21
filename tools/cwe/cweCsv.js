// CSV parsing and field selection for tools/cwe/build-cwe-catalog.mjs. CommonJS so Jest
// can require it.

// CSV column -> catalog field. The three list columns keep MITRE's own
// "::KEY:value:KEY:value" encoding, which the Find CWE page already parses.
const COLUMNS = {
  'CWE-ID': 'cwe_id',
  'Name': 'name',
  'Description': 'description',
  'Extended Description': 'ext_description',
  'Common Consequences': 'consequences',
  'Potential Mitigations': 'mitigations',
  'Detection Methods': 'detection'
};

// RFC 4180: quoted fields may hold commas, line breaks and doubled quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// MITRE ends every list column with '::'; the page splits on the separators itself.
function clean(value) {
  return value.trim().replace(/::$/, '');
}

function toCatalog(rows) {
  const header = rows[0] || [];
  const positions = {};
  Object.keys(COLUMNS).forEach(function (column) {
    const position = header.indexOf(column);
    if (position === -1) {
      throw new Error('CWE CSV has no column ' + column);
    }
    positions[COLUMNS[column]] = position;
  });
  const cwes = {};
  rows.slice(1).forEach(function (row) {
    const entry = {};
    Object.keys(positions).forEach(function (field) {
      const value = clean(row[positions[field]] || '');
      if (value) {
        entry[field] = value;
      }
    });
    if (/^\d+$/.test(entry.cwe_id || '')) {
      cwes[entry.cwe_id] = entry;
    }
  });
  return cwes;
}

module.exports = {parseCsv, toCatalog, COLUMNS};
