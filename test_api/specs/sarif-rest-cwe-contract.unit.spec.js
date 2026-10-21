/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The `GET /api/v2/core/tests/sarif` response shape, executed.
//
// What this closes.
//
// `mapSarifListItem` is the only place the three shipped SARIF modules are
// composed into something a customer sees, and it is the one part of the CWE work
// with no test at all: the four specs that shipped cover the modules
// individually, `tests-sarif.spec.js` is an integration test that needs a live
// API and a seeded company, and nothing checks that the published OpenAPI
// contract matches what the server actually sends.
//
// Three claims are pinned here.
//
//   1. The response is a WHITELIST. `handleSarifList` projects `data` and
//      `companyId` away at the query, but `handleSarifDetail` does not - it reads
//      the whole document and re-attaches the run under `sarif`. So the mapper
//      is the last thing standing between a stored document and the response,
//      and it must not echo the tenant id or the raw run into the list shape.
//
//   2. A mapping belonging to another company never reaches the counts. The
//      overlay's own spec proves `indexMappings` scopes correctly; this proves
//      the REST path actually goes through it.
//
//   3. `findings.cwes` rows carry cwe/count/level and NOTHING else - which is
//      what `public/api-v2/openapi.yaml` documents. Three comments in the shipped
//      source used to say otherwise and were corrected since; see the last
//      block, and cwe-docs-and-tooling.unit.spec.js for the comments themselves.
//
// rest-api/tests.js registers Iron Router routes at import time, so the two
// functions under test are sliced out of the source and evaluated with the real
// helper modules injected. The slice is anchored: if the function is renamed or
// reshaped, loading throws rather than silently testing nothing.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const {getFindingsSummary} = require('../../imports/lib/sarif/runStatus');
const {formatCweFindings} = require('../../imports/lib/sarif/cweExtract');
const {indexMappings, applyMappings} = require('../../imports/lib/sarif/cweMappingOverlay');

const REPO_ROOT = path.join(__dirname, '../..');
const TESTS_JS = 'imports/server/rest-api/tests.js';
const OPENAPI = 'public/api-v2/openapi.yaml';

const OWN_CO = 'company-own';
const OTHER_CO = 'company-other';
const EVAL_RULE = 'python.lang.security.audit.eval-detected';
const SHELL_RULE = 'python.lang.security.audit.subprocess-shell-true';

function read(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

// Slice from `marker` to the brace that closes the first `{` after it.
function sliceBalanced(source, marker, label) {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`${label} no longer contains \`${marker}\`; re-anchor this spec, never delete it`);
  }
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while slicing ${marker} from ${label}`);
}

const TESTS_SOURCE = read(TESTS_JS);
const MAPPER_SRC = sliceBalanced(TESTS_SOURCE, 'function mapSarifListItem(', TESTS_JS);
const INDEX_SRC = sliceBalanced(TESTS_SOURCE, 'async function companyMappingIndex(', TESTS_JS);

// The shipped mapper, with its three imported helpers supplied for real.
const mapSarifListItem = new Function(
  'getFindingsSummary', 'formatCweFindings', 'applyMappings',
  `${MAPPER_SRC}\nreturn mapSarifListItem;`
)(getFindingsSummary, formatCweFindings, applyMappings);

// The shipped index builder, with the collection read supplied.
function buildCompanyMappingIndex(mappings) {
  const seen = [];
  const load = async function (companyId) {
    seen.push(companyId);
    return mappings.filter((mapping) =>
      !mapping.companyId || mapping.companyId === companyId ||
      // A deliberately sloppy loader: it hands back the OTHER tenant's rows too,
      // so the only thing that can keep them out of the response is indexMappings.
      mapping.leaky === true);
  };
  const companyMappingIndex = new Function(
    'indexMappings', 'CweMappingsFindForCompany',
    `${INDEX_SRC}\nreturn companyMappingIndex;`
  )(indexMappings, load);
  return {companyMappingIndex, seen};
}

function storedDoc(overrides) {
  return Object.assign({
    _id: 'test-1',
    // Neither of these may appear in the response.
    companyId: OWN_CO,
    data: JSON.stringify({tool: {driver: {name: 'semgrep'}}, results: []}),
    type: 'SAST',
    tool: 'semgrep',
    submitted: '2026-08-27T10:00:00.000Z',
    status: 'FAILED',
    projectName: 'proj',
    moduleName: 'mod',
    moduleId: 'mod-1',
    scanId: 'scan-1',
    analysisId: 'an-1',
    rules: {
      total: 1074,
      violations: 1,
      warnings: 1,
      notes: 0,
      byRule: {
        violations: {'python___lang___security___audit___eval-detected': 4},
        warnings: {'python___lang___security___audit___subprocess-shell-true': 2},
        notes: {}
      },
      byCwe: {'CWE-79': {violations: 4, warnings: 0, notes: 0}}
    }
  }, overrides);
}

function mapping(overrides) {
  return Object.assign({
    companyId: OWN_CO, tool: 'semgrep', ruleId: SHELL_RULE, cwes: ['CWE-78']
  }, overrides);
}

function mapWith(doc, mappings) {
  return mapSarifListItem(doc, indexMappings(mappings || [], OWN_CO));
}

// --- the slice really came out of the shipped source -----------------------

describe('the REST mapper under test is the shipped one', () => {
  it('sliced mapSarifListItem and companyMappingIndex with their composition intact', () => {
    expect(MAPPER_SRC).toContain('getFindingsSummary(doc.rules)');
    expect(MAPPER_SRC).toContain('formatCweFindings(applyMappings(');
    expect(MAPPER_SRC).toContain('doc.rules && doc.rules.byRule');
    expect(INDEX_SRC).toContain('indexMappings(await CweMappingsFindForCompany(companyId), companyId)');
    expect(typeof mapSarifListItem).toBe('function');
  });

  it('is reached by both endpoints, list and detail', () => {
    // A change that stopped the detail endpoint building its index would leave
    // assigned weaknesses out of one half of the API only.
    expect(TESTS_SOURCE).toMatch(/docs\.map\(function \(doc\) \{\s*return mapSarifListItem\(doc, mappingIndex\)/);
    expect(TESTS_SOURCE)
      .toContain('mapSarifListItem(doc, await companyMappingIndex(keyMetaAndCompany.company._id))');
  });
});

// --- 1: the response is a whitelist ----------------------------------------

describe('#126 the SARIF list item echoes metadata and counts, and nothing else', () => {
  it('emits exactly the documented top-level keys', () => {
    expect(Object.keys(mapWith(storedDoc())).sort()).toEqual([
      '_id', 'analysisId', 'findings', 'moduleId', 'moduleName', 'origin',
      'projectName', 'rules', 'scanId', 'status', 'submitted', 'type'
    ]);
  });

  it('never echoes the tenant id or the stored run', () => {
    const item = mapWith(storedDoc());
    expect(item.companyId).toBeUndefined();
    expect(item.data).toBeUndefined();
    // Both directions: the source document really did carry both, so the
    // absence above is the mapper's doing and not an empty fixture.
    expect(storedDoc().companyId).toBe(OWN_CO);
    expect(typeof storedDoc().data).toBe('string');
    expect(JSON.stringify(item)).not.toContain(OWN_CO);
  });

  it('keeps the pre-#126 counts untouched beside the new breakdown', () => {
    const item = mapWith(storedDoc());
    expect(item.origin).toBe('semgrep');
    expect(item.rules).toEqual({total: 1074, violations: 1, warnings: 1, notes: 0});
    expect(item.findings).toMatchObject({total: 6, violations: 4, warnings: 2, notes: 0});
    expect(Object.keys(item.findings).sort())
      .toEqual(['cwes', 'notes', 'total', 'violations', 'warnings']);
  });

  it('survives a document with no rules block at all', () => {
    const item = mapWith(storedDoc({rules: undefined}));
    expect(item.rules).toBeUndefined();
    expect(item.findings).toEqual({total: 0, violations: 0, warnings: 0, notes: 0, cwes: []});
  });

  it('reports an empty cwes array for a tool that published none', () => {
    const item = mapWith(storedDoc({rules: {total: 3, violations: 0, warnings: 1, notes: 0,
      byRule: {violations: {}, warnings: {'flake8___E501': 7}, notes: {}}, byCwe: {}}}));
    expect(item.findings.cwes).toEqual([]);
    expect(item.findings.total).toBe(7);
  });
});

// --- 2: an assignment is counted, and only the caller's --------------------

describe('#112 an assigned weakness reaches the API, scoped to the calling company', () => {
  it('counts the assigned rule\'s findings under the weakness a human named', () => {
    const item = mapWith(storedDoc(), [mapping()]);
    expect(item.findings.cwes).toEqual([
      {cwe: 'CWE-79', count: 4, level: 'violation'},
      {cwe: 'CWE-78', count: 2, level: 'warning'}
    ]);
    // The totals are untouched: the overlay adds a breakdown, not findings.
    expect(item.findings.total).toBe(6);
  });

  it('ignores a mapping that belongs to another company', () => {
    const item = mapWith(storedDoc(), [mapping({companyId: OTHER_CO, cwes: ['CWE-999']})]);
    expect(item.findings.cwes).toEqual([{cwe: 'CWE-79', count: 4, level: 'violation'}]);
    expect(JSON.stringify(item)).not.toContain('CWE-999');
  });

  it('applies a global default, and lets the company\'s own entry replace it', () => {
    const globalOnly = mapWith(storedDoc(),
      [mapping({companyId: null, cwes: ['CWE-94']})]);
    expect(globalOnly.findings.cwes)
      .toContainEqual({cwe: 'CWE-94', count: 2, level: 'warning'});

    const overridden = mapWith(storedDoc(), [
      mapping({companyId: null, cwes: ['CWE-94']}),
      mapping({cwes: ['CWE-78']})
    ]);
    expect(overridden.findings.cwes).toContainEqual({cwe: 'CWE-78', count: 2, level: 'warning'});
    expect(overridden.findings.cwes.map((row) => row.cwe)).not.toContain('CWE-94');
  });

  it('reaches a document imported before rules.byCwe existed', () => {
    // The whole reason the overlay works off byRule: no migration, no re-parse.
    const legacy = storedDoc({rules: {total: 1074, violations: 1, warnings: 1, notes: 0,
      byRule: {violations: {'python___lang___security___audit___eval-detected': 4},
        warnings: {'python___lang___security___audit___subprocess-shell-true': 2}, notes: {}}}});
    expect(legacy.rules.byCwe).toBeUndefined();

    const item = mapWith(legacy, [mapping(), mapping({ruleId: EVAL_RULE, cwes: ['CWE-95']})]);
    expect(item.findings.cwes).toEqual([
      {cwe: 'CWE-95', count: 4, level: 'violation'},
      {cwe: 'CWE-78', count: 2, level: 'warning'}
    ]);
  });

  it('matches the mapping against the tool name stored on the document', () => {
    // The document says "semgrep"; a mapping filed under "Semgrep" from the UI
    // has to reach it, and one filed under a different tool must not.
    expect(mapWith(storedDoc(), [mapping({tool: 'Semgrep'})]).findings.cwes)
      .toContainEqual({cwe: 'CWE-78', count: 2, level: 'warning'});
    expect(mapWith(storedDoc({tool: 'Bandit'}), [mapping()]).findings.cwes)
      .toEqual([{cwe: 'CWE-79', count: 4, level: 'violation'}]);
  });

  it('does not mutate the stored document while overlaying', () => {
    const doc = storedDoc();
    const before = JSON.stringify(doc.rules);
    mapWith(doc, [mapping()]);
    expect(JSON.stringify(doc.rules)).toBe(before);
  });

  it('orders rows busiest first, ties by ascending weakness number', () => {
    const item = mapWith(storedDoc({rules: {total: 9, violations: 2, warnings: 0, notes: 0,
      byRule: {violations: {}, warnings: {}, notes: {}},
      byCwe: {
        'CWE-89': {violations: 2, warnings: 0, notes: 0},
        'CWE-79': {violations: 5, warnings: 0, notes: 0},
        'CWE-22': {violations: 2, warnings: 0, notes: 0}
      }}}));
    expect(item.findings.cwes.map((row) => row.cwe)).toEqual(['CWE-79', 'CWE-22', 'CWE-89']);
  });
});

describe('#112 companyMappingIndex scopes the read it was handed', () => {
  it('passes the caller\'s company to the lookup and to indexMappings', async () => {
    const {companyMappingIndex, seen} = buildCompanyMappingIndex([mapping()]);
    await companyMappingIndex(OWN_CO);
    expect(seen).toEqual([OWN_CO]);
  });

  it('drops a foreign row even when the lookup leaks one', async () => {
    // Defence in depth, stated in the source as "the second lock": if a query
    // somewhere ever returned another tenant's mapping, indexMappings must still
    // refuse to apply it.
    const {companyMappingIndex} = buildCompanyMappingIndex([
      mapping({companyId: OTHER_CO, cwes: ['CWE-999'], leaky: true})
    ]);
    const item = mapSarifListItem(storedDoc(), await companyMappingIndex(OWN_CO));
    expect(item.findings.cwes).toEqual([{cwe: 'CWE-79', count: 4, level: 'violation'}]);
  });

  it('NON-VACUITY: the caller\'s own row from the same loader IS applied', async () => {
    const {companyMappingIndex} = buildCompanyMappingIndex([mapping()]);
    const item = mapSarifListItem(storedDoc(), await companyMappingIndex(OWN_CO));
    expect(item.findings.cwes).toContainEqual({cwe: 'CWE-78', count: 2, level: 'warning'});
  });
});

// --- 3: the published contract ---------------------------------------------

describe('#112 the response shape matches what openapi.yaml publishes', () => {
  const spec = yaml.load(read(OPENAPI));

  // Find every schema that documents findings.cwes, by shape rather than by
  // name, so renaming a schema does not silently skip the check.
  const documented = Object.keys(spec.components.schemas)
    .map((name) => ({name, node: spec.components.schemas[name]}))
    .map((entry) => ({
      name: entry.name,
      cwes: entry.node && entry.node.properties && entry.node.properties.findings &&
        entry.node.properties.findings.properties &&
        entry.node.properties.findings.properties.cwes
    }))
    .filter((entry) => entry.cwes);

  it('documents findings.cwes on both the list item and the detail document', () => {
    expect(documented.map((entry) => entry.name).sort())
      .toEqual(['SARIFDocument', 'SARIFDocumentSummary']);
  });

  documented.forEach((entry) => {
    it(`${entry.name}: the documented row fields are exactly the ones the server sends`, () => {
      const item = mapWith(storedDoc(), [mapping()]);
      expect(item.findings.cwes.length).toBeGreaterThan(0);
      const sent = new Set();
      item.findings.cwes.forEach((row) => Object.keys(row).forEach((key) => sent.add(key)));

      expect([...sent].sort()).toEqual(Object.keys(entry.cwes.items.properties).sort());
      // NO `source` field. Three comments in the shipped source used to claim one
      // existed - rest-api/tests.js ("carrying `source: 'assigned'`") and
      // cweMappingOverlay.js twice - against the code and the OpenAPI schema.
      // The comments were
      // corrected since; this keeps pinning the behaviour the contract
      // documents, so the field cannot arrive by the back door either.
      expect(sent.has('source')).toBe(false);
    });

    it(`${entry.name}: every level the server emits is in the documented enum`, () => {
      const allLevels = mapWith(storedDoc({rules: {total: 3, violations: 1, warnings: 1, notes: 1,
        byRule: {violations: {}, warnings: {}, notes: {}},
        byCwe: {'CWE-79': {violations: 1, warnings: 1, notes: 1}}}}));
      const levels = allLevels.findings.cwes.map((row) => row.level);
      expect(levels.sort()).toEqual(['note', 'violation', 'warning']);
      levels.forEach((level) => {
        expect(entry.cwes.items.properties.level.enum).toContain(level);
      });
    });
  });
});
