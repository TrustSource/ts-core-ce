/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// What the SARIF CWE feature SAYS about itself, checked against what it does.
//
// Three separate claims went out with the SARIF CWE feature that nothing executes:
//
//   1. Three code comments - cweMappingOverlay.js twice and rest-api/tests.js
//      once - describe a `source: 'assigned'` field on the REST `cwes` rows.
//      `formatCweFindings` emits `{cwe, count, level}` and openapi.yaml documents
//      exactly those three. The comments are what is wrong; the contract is
//      intact and must NOT grow a `source` field.
//
//   2. The `cwes` description in openapi.yaml contradicted itself: it stated the
//      counts "sum to more than `total`" and then, two sentences later,
//      described the case where they sum to less (a rule with no known weakness
//      is omitted entirely, so an empty array beside a non-zero `total` is
//      normal).
//
//   3. tools/security/regress-tenant.mjs logged SKIP for the whole CWE-mappings
//      isolation block when `CweMappings.Set` was denied, incremented neither
//      counter, and still exited 0 - so a CI run with an under-privileged
//      account exercised none of the isolation checks and reported success. Its
//      probe cleanup also sat outside any `finally`, so a throw anywhere in the
//      block left a mapping behind in the database.
//
// The regress script's CWE-mappings block is sliced out of the shipped source and
// EXECUTED against stubs, the same way sarif-rest-cwe-contract.unit.spec.js
// executes the REST mapper.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const {formatCweFindings} = require('../../imports/lib/sarif/cweExtract');
const {indexMappings, applyMappings} = require('../../imports/lib/sarif/cweMappingOverlay');

const REPO_ROOT = path.join(__dirname, '../..');
const OVERLAY_JS = 'imports/lib/sarif/cweMappingOverlay.js';
const REST_JS = 'imports/server/rest-api/tests.js';
const OPENAPI = 'public/api-v2/openapi.yaml';
const REGRESS_MJS = 'tools/security/regress-tenant.mjs';

function read(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

// --- 1: the comments describe the code --------------------------------------

describe('#128 no comment promises an API field the server does not send', () => {
  const SOURCES = [OVERLAY_JS, REST_JS];

  SOURCES.forEach((relative) => {
    it(`${relative} no longer describes a source field on the cwes rows`, () => {
      const source = read(relative);
      expect(source).not.toMatch(/source:\s*'assigned'/);
      expect(source).not.toMatch(/`source`\s+field/);
    });
  });

  it('THE CODE SIDE: the rows really carry cwe, count and level only', () => {
    const rows = formatCweFindings(applyMappings(
      {'CWE-79': {violations: 2, warnings: 0, notes: 0}},
      {violations: {'py___xss': 2}, warnings: {}, notes: {}},
      indexMappings([{companyId: 'acme', tool: 'semgrep', ruleId: 'py.sqli', cwes: ['CWE-89']}],
        'acme'),
      'semgrep'));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => expect(Object.keys(row).sort()).toEqual(['count', 'cwe', 'level']));
  });

  it('the overlay still explains what the assigned sub-count is for', () => {
    // The comments are corrected, not deleted: `assigned` exists and the UI
    // reads it, so the reason it is there has to survive the fix.
    expect(read(OVERLAY_JS)).toContain('assigned');
  });
});

// --- 2: the published description --------------------------------------------

describe('#128 the openapi cwes description does not contradict itself', () => {
  const spec = yaml.load(read(OPENAPI));

  const documented = Object.keys(spec.components.schemas)
    .map((name) => ({
      name,
      cwes: spec.components.schemas[name] &&
        spec.components.schemas[name].properties &&
        spec.components.schemas[name].properties.findings &&
        spec.components.schemas[name].properties.findings.properties &&
        spec.components.schemas[name].properties.findings.properties.cwes
    }))
    .filter((entry) => entry.cwes);

  it('documents cwes on both the list item and the detail document', () => {
    expect(documented.map((entry) => entry.name).sort())
      .toEqual(['SARIFDocument', 'SARIFDocumentSummary']);
  });

  it('keeps the two descriptions byte-identical', () => {
    const texts = documented.map((entry) => entry.cwes.description);
    expect(new Set(texts).size).toBe(1);
  });

  documented.forEach((entry) => {
    it(`${entry.name}: drops the false absolute about summing to more than total`, () => {
      expect(entry.cwes.description).not.toMatch(/sum to more than/);
    });

    it(`${entry.name}: says the counts do not reconcile with total, and why both ways`, () => {
      const text = entry.cwes.description;
      expect(text).toMatch(/do not reconcile with `total`/);
      // Both directions have to be there: over-counting (a multi-CWE rule) and
      // under-counting (a rule with no known weakness).
      expect(text).toMatch(/several CWEs|more than one CWE/);
      expect(text).toMatch(/no known weakness|not counted here/);
    });

    it(`${entry.name}: still documents exactly cwe, count and level`, () => {
      expect(Object.keys(entry.cwes.items.properties).sort())
        .toEqual(['count', 'cwe', 'level']);
    });
  });
});

// --- 3: the cross-tenant regression script ----------------------------------

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

const REGRESS_SOURCE = read(REGRESS_MJS);
const BLOCK_SRC = sliceBalanced(REGRESS_SOURCE, "console.log('-- cwe mappings (#112)", REGRESS_MJS);

// Runs the shipped CWE-mappings block with every collaborator stubbed.
//   denySet   - make CweMappings.Set answer "Access Denied", the situation that
//               used to skip the whole block and still exit 0
//   explodeAt - throw from the Nth `sub('cweMappings')`, to see whether the
//               probe is still withdrawn
async function runBlock(options) {
  const opts = options || {};
  const calls = [];
  let pass = 0;
  let fail = 0;
  const logged = [];
  let subs = 0;
  // The collection, as the two tenants would really see it.
  const store = [];

  // The shipped `check` counts and prints; both matter here, because a skipped
  // block has to be visible in the output as well as in the exit code.
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; }
    calls.push({op: 'check', cond: !!cond, label});
    logged.push((cond ? '  PASS ' : '  FAIL ') + label);
  };
  const isDenied = (r) => !!(r && r.error);

  // A DDP client belonging to one company: writes are filed under it, and a
  // remove naming another company's id is refused the way the interactor does.
  function clientFor(companyId, email) {
    return {
      call: async function (name, args) {
        calls.push({op: 'call', name, args, as: companyId});
        const params = (args && args[0]) || {};
        if (name === 'CweMappings.Set') {
          if (opts.denySet) {
            return {error: {error: 403, reason: 'Access Denied'}};
          }
          store.push({ruleId: params.ruleId, tool: params.tool, companyId});
          return {result: {tool: params.tool, ruleId: params.ruleId}};
        }
        if (name === 'CweMappings.Remove') {
          // The company is the caller's, never the argument's.
          const hit = store.findIndex((doc) =>
            doc.ruleId === params.ruleId && doc.companyId === companyId);
          if (hit !== -1) {
            store.splice(hit, 1);
          }
          return {result: hit === -1 ? 0 : 1};
        }
        return {result: 1};
      },
      email
    };
  }

  const ca = clientFor('company-a', 'a');
  const cb = clientFor('company-b', 'b');
  const companyOf = {a: 'company-a', b: 'company-b'};

  class DDPClient {
    async connect() { return this; }
    async login(email) {
      this.companyId = companyOf[email];
      return {};
    }
    async sub(name) {
      subs += 1;
      calls.push({op: 'sub', name});
      if (opts.explodeAt && subs === opts.explodeAt) {
        throw new Error('connection lost');
      }
      return null;
    }
    docs() {
      const own = this.companyId;
      return store.filter((doc) => doc.companyId === own)
        .map((doc) => ({ruleId: doc.ruleId, companyId: doc.companyId}));
    }
    close() {}
  }

  const console_ = {log: (...args) => logged.push(args.join(' ')),
    error: (...args) => logged.push(args.join(' '))};

  const body = new Function('ca', 'cb', 'check', 'isDenied', 'DDPClient', 'A', 'B',
    'aCompanyId', 'bCompanyId', 'console',
    `return (async () => {\n${BLOCK_SRC}\n})();`);

  let thrown = null;
  try {
    await body(ca, cb, check, isDenied, DDPClient, {email: 'a'}, {email: 'b'},
      'company-a', 'company-b', console_);
  } catch (error) {
    thrown = error;
  }
  return {calls, pass, fail, logged, thrown, store};
}

describe('#128 the #112 block under test is the shipped one', () => {
  it('sliced the block with its probe intact', () => {
    expect(BLOCK_SRC).toContain('CweMappings.Set');
    expect(BLOCK_SRC).toContain('CweMappings.Remove');
    expect(BLOCK_SRC).toContain('regress.cross.tenant.probe');
  });

  it('NON-VACUITY: with Set allowed, the isolation checks all run and pass', async () => {
    const world = await runBlock();
    expect(world.fail).toBe(0);
    expect(world.pass).toBeGreaterThanOrEqual(5);
    expect(world.thrown).toBeNull();
  });
});

describe('#128 a skipped isolation block fails the run instead of passing it', () => {
  it('records a failure when CweMappings.Set is denied', async () => {
    const world = await runBlock({denySet: true});
    expect(world.fail).toBeGreaterThan(0);
  });

  it('says out loud, as a FAIL, that the checks did not run', async () => {
    const world = await runBlock({denySet: true});
    expect(world.logged.join('\n')).toMatch(/FAIL[\s\S]*DID NOT RUN/);
    expect(world.pass).toBe(0);
  });

  it('the script exits on the failure count, so a skip cannot exit 0', () => {
    expect(REGRESS_SOURCE).toContain('process.exit(fail ? 1 : 0)');
  });
});

describe('#128 the probe is withdrawn even when the block throws', () => {
  function removeCalls(world) {
    return world.calls.filter((entry) =>
      entry.op === 'call' && entry.name === 'CweMappings.Remove' &&
      entry.args && entry.args[0] && !entry.args[0].companyId);
  }

  it('withdraws it on the happy path', async () => {
    const world = await runBlock();
    expect(removeCalls(world)).toHaveLength(1);
    expect(world.store).toEqual([]);
  });

  it('withdraws it when a later step throws, and re-raises', async () => {
    // Without a finally, the throw skips the cleanup and leaves a mapping in the
    // database for whoever runs the script next.
    const world = await runBlock({explodeAt: 2});
    expect(world.thrown).not.toBeNull();
    expect(removeCalls(world)).toHaveLength(1);
    expect(world.store).toEqual([]);
  });

  it('the cleanup really is in a finally, not merely last', () => {
    expect(BLOCK_SRC).toMatch(/finally\s*\{/);
  });

  it('the watchdog names what it may have left behind', () => {
    // A hard `setTimeout(process.exit)` cannot await a cleanup, so the timeout
    // path has to report the residue rather than hide it.
    expect(REGRESS_SOURCE).toMatch(/clearTimeout/);
    expect(REGRESS_SOURCE).toMatch(/residue|left behind/i);
  });
});
