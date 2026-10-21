// ---------------------------------------------------------------------------
// AC14: every product_id a vulnerability references must exist in the product_tree.
//
// The existing coverage in csaf-product-id.unit.spec.js lifts the branch builder
// and the per-path product_ids statement out of vex.js, but then assembles the
// document BY HAND and checks set containment over it. Both sides of that
// containment are derived from the same productIds map inside the test, so the
// assertion holds by construction - the only part carrying signal is
// `expect(referenced).not.toContain(undefined)`.
//
// The code that actually decides AC14 is the reconciliation block at the end of
// fromVulnerabilityReport (vex.js: `if (root.vulnerabilities && ...)`), which
// collects every referenced id and REPLACES the tree's module branches with the
// referenced subset. That block has never been executed by a test. It is lifted
// and run here, together with the real branch builder, the real per-path lookup
// and the real merge helper, so the criterion is exercised end to end.
//
// vex.js imports meteor/*, so lifting is the only option under Jest. Every anchor
// throws loudly if the shipped shape changes.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const _ = require('underscore');

const REPO_ROOT = path.join(__dirname, '../..');
const VEX_JS = 'imports/lib/converter/vex.js';

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const VEX_SRC = stripComments(fs.readFileSync(path.join(REPO_ROOT, VEX_JS), 'utf8'));

function sliceBalanced(marker, open, close) {
  const start = VEX_SRC.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `${VEX_JS} no longer contains \`${marker}\`; re-anchor this spec, never delete it`);
  }
  let depth = 0;
  for (let i = VEX_SRC.indexOf(open, start); i < VEX_SRC.length; i += 1) {
    if (VEX_SRC[i] === open) depth += 1;
    else if (VEX_SRC[i] === close) {
      depth -= 1;
      if (depth === 0) return VEX_SRC.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${open}${close} while slicing ${marker} from ${VEX_JS}`);
}

// --- the lifted pieces ------------------------------------------------------

const toPurl = new Function(`${sliceBalanced('function toPurl(', '{', '}')}\nreturn toPurl;`)();

const BRANCHES_BLOCK = sliceBalanced('let branchesModules = _.map(modules', '(', ')');
const runBranches = new Function(
  'modules', 'productIds', '_', 'toPurl', 'Config', 'moment',
  `${BRANCHES_BLOCK}\nreturn branchesModules;`);

const PRODUCT_IDS_STMT = (function () {
  const start = VEX_SRC.search(/^[ \t]*let product_ids = /m);
  if (start === -1) {
    throw new Error(`${VEX_JS} no longer has a \`let product_ids = ...\` statement`);
  }
  // Taken through balanced parentheses rather than to end of line: the statement
  // spans several lines since it gained the hasOwnProperty guard on the
  // cryptoMap lookup, and slicing only its first line yields a syntax error.
  let depth = 0;
  for (let i = VEX_SRC.indexOf('(', start); i < VEX_SRC.length; i++) {
    if (VEX_SRC[i] === '(') depth += 1;
    else if (VEX_SRC[i] === ')') {
      depth -= 1;
      if (depth === 0) return VEX_SRC.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced parentheses in the ${VEX_JS} product_ids statement`);
})();
const runProductIds = new Function(
  'productIds', 'cryptoMap', 'paths', '_', `${PRODUCT_IDS_STMT}\nreturn product_ids;`);

// The reconciliation block: collect every referenced product_id, then narrow the
// tree's module branches to the referenced ones.
const RECONCILE_BLOCK = sliceBalanced(
  'if (root.vulnerabilities && root.vulnerabilities.length) {', '{', '}');
const runReconcile = new Function('root', 'branchesModules', `${RECONCILE_BLOCK}\nreturn root;`);

// The merge helper. Its `_.uniq([...ids, otherIds])` pushes an ARRAY into
// threats[0].product_ids - a pre-existing defect, verifiable at baseline
// 15d9ad4f1 and deliberately NOT fixed by this change, which is exactly why AC14
// is scoped to string elements.
const MERGE_FN = new Function(
  '_',
  `${sliceBalanced('const addVulnerabilityIfNotAvailable = function (cve, vulnerability) {', '{', '}')};
   return addVulnerabilityIfNotAvailable;`)(_);

const CONFIG = {appUrl: 'https://app.example.io/'};
const MOMENT = () => ({toISOString: () => '1970-01-01T00:00:00.000Z'});

// --- assembly ---------------------------------------------------------------

function emptyTree(branchesModules) {
  return {
    product_tree: {
      branches: [{
        category: 'vendor',
        name: 'Acme',
        branches: [{category: 'product_name', name: 'Project A', branches: branchesModules}]
      }]
    }
  };
}

function treeIds(root) {
  return root.product_tree.branches[0].branches[0].branches.map((b) => b.product.product_id);
}

// The same collection the reconciliation block performs, applied to the FINISHED
// document so the assertion is about the emitted output rather than about an
// intermediate the block happens to keep.
function referencedIds(root) {
  const out = [];
  (root.vulnerabilities || []).forEach((vulnerability) => {
    Object.values(vulnerability.product_status || {})
      .forEach((arr) => out.push(...(arr || [])));
    (vulnerability.remediations || []).forEach((r) => out.push(...(r.product_ids || [])));
    (vulnerability.threats || []).forEach((t) => out.push(...(t.product_ids || [])));
    (vulnerability.scores || []).forEach((s) => out.push(...(s.products || [])));
  });
  return out;
}

const MODULES = [
  {_id: 'm1', name: 'left-pad', version: '1.0.0', key: 'npm:left-pad'},
  {_id: 'm2', name: 'beta', version: '2.0.0', key: 'npm:beta'},
  {_id: 'm3', name: 'gamma', version: '3.0.0'}          // no purl -> x_generic_uris
];
const TOKENS = {m1: 'v2:tok-one', m2: 'v2:tok-two', m3: 'v2:tok-three'};

function buildDocument(paths, {productIds = TOKENS, modules = MODULES} = {}) {
  const branchesModules = runBranches(modules, productIds, _, toPurl, CONFIG, MOMENT);
  const ids = runProductIds(null, productIds, paths, _);
  const root = emptyTree(branchesModules);
  if (ids.length) {
    root.vulnerabilities = [{
      cve: 'CVE-2026-1111',
      product_status: {under_investigation: ids},
      remediations: [{category: 'none_available', details: 'Investigation in progress', product_ids: ids}],
      scores: [{cvss_v2: {baseScore: 5}, products: ids}]
    }];
  }
  return {root: runReconcile(root, branchesModules), ids, branchesModules};
}

// ---------------------------------------------------------------------------

describe('the vex.js blocks under test really came out of vex.js', () => {
  it('lifted the reconciliation block, not something that merely looks like it', () => {
    expect(RECONCILE_BLOCK).toContain('referenced');
    expect(RECONCILE_BLOCK).toContain('product_status');
    expect(RECONCILE_BLOCK).toContain('remediations');
    expect(RECONCILE_BLOCK).toContain('threats');
    expect(RECONCILE_BLOCK).toContain('scores');
    expect(RECONCILE_BLOCK).toContain('branchesModules.filter');
  });

  it('lifted the per-path lookup with its compact guard', () => {
    // _.compact is what stops an unmapped moduleId injecting `undefined` into
    // product_status while never appearing in the tree.
    expect(PRODUCT_IDS_STMT).toContain('_.compact');
    expect(PRODUCT_IDS_STMT).toContain('cryptoMap');
  });

  it('lifted the merge helper', () => {
    expect(typeof MERGE_FN).toBe('function');
  });
});

describe('AC14: every referenced product_id exists in the emitted product_tree', () => {
  it('holds when every path points at a module in the generated set', () => {
    const {root} = buildDocument([{moduleId: 'm1'}, {moduleId: 'm2'}]);
    const known = new Set(treeIds(root));
    const referenced = referencedIds(root).filter((id) => typeof id === 'string');
    expect(referenced.length).toBeGreaterThan(0);
    referenced.forEach((id) => expect(known.has(id)).toBe(true));
  });

  it('holds when a path points at a module OUTSIDE the generated set', () => {
    // The compact guard drops the unmapped lookup, so nothing dangling is emitted.
    const {root, ids} = buildDocument([{moduleId: 'm1'}, {moduleId: 'not-generated'}]);
    expect(ids).toEqual(['v2:tok-one']);
    expect(referencedIds(root)).not.toContain(undefined);
    const known = new Set(treeIds(root));
    referencedIds(root).filter((id) => typeof id === 'string')
      .forEach((id) => expect(known.has(id)).toBe(true));
  });

  it('narrows the tree to the referenced modules, dropping the rest', () => {
    // Both directions. The referenced module survives...
    const {root} = buildDocument([{moduleId: 'm2'}]);
    expect(treeIds(root)).toEqual(['v2:tok-two']);
    // ...and the two unreferenced ones are gone, not merely still present.
    expect(treeIds(root)).not.toContain('v2:tok-one');
    expect(treeIds(root)).not.toContain('v2:tok-three');
  });

  it('keeps the whole tree when a document has no vulnerabilities at all', () => {
    const {root} = buildDocument([]);
    expect(root.vulnerabilities).toBeUndefined();
    expect(treeIds(root).sort()).toEqual(['v2:tok-one', 'v2:tok-three', 'v2:tok-two']);
  });

  it('keeps the whole tree rather than emptying it when nothing matched', () => {
    // The `if (filtered.length)` fallback. A document whose every reference is
    // unresolvable keeps its branches instead of shipping an empty product_tree.
    const branchesModules = runBranches(MODULES, TOKENS, _, toPurl, CONFIG, MOMENT);
    const root = emptyTree(branchesModules);
    root.vulnerabilities = [{
      cve: 'CVE-2026-2222',
      product_status: {known_affected: ['v2:a-token-from-another-document']}
    }];
    runReconcile(root, branchesModules);
    expect(treeIds(root)).toHaveLength(3);
  });

  it('the purl-less module keeps its x_generic_uris through the reconciliation', () => {
    const {root} = buildDocument([{moduleId: 'm3'}]);
    const branch = root.product_tree.branches[0].branches[0].branches[0];
    expect(branch.product.product_id).toBe('v2:tok-three');
    expect(branch.product.product_identification_helper.x_generic_uris[0].uri)
      .toBe(`${CONFIG.appUrl}module/${encodeURIComponent('v2:tok-three')}`);
    expect(JSON.stringify(root)).not.toContain('"m3"');
  });
});

describe('AC14 scoping: the pre-existing nested-array defect, reproduced with the real merge', () => {
  // vex.js's addVulnerabilityIfNotAvailable does
  //   _.uniq([...cve.threats[0].product_ids, vulnerability.threats[0].product_ids])
  // - spreading one side and appending the other WHOLE, so a merged CVE ends up
  // with an ARRAY inside threats[].product_ids. Verifiable at baseline 15d9ad4f1
  // and explicitly out of scope for this change; AC14 is therefore scoped to
  // string elements. Reproduced with the shipped helper rather than a hand-made
  // fixture, so the scoping stays honest if the defect is ever fixed.
  it('the shipped merge really does nest an array', () => {
    const first = {threats: [{category: 'impact', product_ids: ['v2:tok-one']}]};
    const second = {threats: [{category: 'impact', product_ids: ['v2:tok-two']}]};
    MERGE_FN(first, second);
    const merged = first.threats[0].product_ids;
    expect(merged.some((entry) => Array.isArray(entry))).toBe(true);
    expect(merged.filter((entry) => typeof entry === 'string')).toEqual(['v2:tok-one']);
  });

  it('every STRING id in a merged document still exists in the tree', () => {
    const branchesModules = runBranches(MODULES, TOKENS, _, toPurl, CONFIG, MOMENT);
    const first = {
      cve: 'CVE-2026-3333',
      product_status: {known_affected: ['v2:tok-one']},
      threats: [{category: 'impact', product_ids: ['v2:tok-one']}]
    };
    MERGE_FN(first, {
      product_status: {known_affected: ['v2:tok-two']},
      threats: [{category: 'impact', product_ids: ['v2:tok-two']}]
    });
    const root = emptyTree(branchesModules);
    root.vulnerabilities = [first];
    runReconcile(root, branchesModules);

    const known = new Set(treeIds(root));
    const referenced = referencedIds(root);
    const strings = referenced.filter((id) => typeof id === 'string');
    expect(strings.length).toBeGreaterThan(0);
    strings.forEach((id) => expect(known.has(id)).toBe(true));
    // And nothing undefined leaked in alongside the known array element.
    expect(referenced).not.toContain(undefined);
  });
});

describe('AC14 rests on a caller precondition, not on a check inside vex.js', () => {
  it('CHARACTERISATION: a productIds map with an id outside `modules` leaves a dangling reference', () => {
    // Not reachable from any shipped call site: all three of them build the map
    // from exactly the module list they hand to fromVulnerabilityReport
    //   - imports/server/collections/companies.js       publicVexKey.getFile
    //   - imports/client/ui/reports/report-vulnerability/report-vulnerability.js
    //   - imports/client/ui/common/vex-by-report/vex-by-report.js
    // Pinned so the invariant is visible: vex.js does NOT enforce it, so a fifth
    // call site that passes a wider map would emit a product_status entry with no
    // matching branch. If this ever starts failing, vex.js gained the check and
    // this test should be replaced by the stronger assertion.
    const widerMap = {...TOKENS, extra: 'v2:tok-extra'};
    const {root} = buildDocument([{moduleId: 'm1'}, {moduleId: 'extra'}], {productIds: widerMap});
    const known = new Set(treeIds(root));
    expect(referencedIds(root)).toContain('v2:tok-extra');
    expect(known.has('v2:tok-extra')).toBe(false);
  });

  it('the three shipped call sites derive the map from the module set they generate over', () => {
    const sources = {
      'imports/server/collections/companies.js': /encodeIdMap\(\(data\.modules \|\| \[\]\)\.map\(/,
      'imports/client/ui/common/vex-by-report/vex-by-report.js':
        /CSAF\.EncodeModuleIds', modules\.map\(/,
      'imports/client/ui/reports/report-vulnerability/report-vulnerability.js':
        /CSAF\.EncodeModuleIds', modules\.map\(/
    };
    Object.entries(sources).forEach(([rel, pattern]) => {
      const live = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
      expect(live).toMatch(pattern);
    });
  });
});
