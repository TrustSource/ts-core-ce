/* eslint-disable no-undef, no-new-func */
// The "Export as CSAF" toolbar button (imports/client/ui/common/vex-by-report),
// rendered on three toolbars: the Vulnerabilities report, Approves and
// Release-new.
//
// WHAT WAS UNCOVERED. The click handler awaited VEX.fromVulnerabilityReport with
// no error handling at all. Every rejection therefore left instance.loading at
// `true` for the lifetime of the template - a spinner that never stops, on a
// button that can never be pressed again - and surfaced as an unhandled
// rejection. That stopped being theoretical with b42c538fc: CSAF.Create now
// enforces a server-side role check, and this button passes `createCSAF = true`,
// so a user holding none of manager / compliance_manager /
// company_security_manager / account_admin gets a 403 on the very first click.
//
// The DECIDED behaviour is to fail CLOSED: toast the failure, clear the spinner,
// download NOTHING. Handing the user a file the server refused to file would be
// worse than the spinner.
//
// vex-by-report.js imports meteor/* and cannot be required under Jest, so rather
// than assert about the handler's TEXT this file LIFTS the real handler out of
// the module and EXECUTES it against stubs. Source locks would only prove the
// code is shaped right; these prove it behaves right.
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '../..', 'imports/client/ui/common/vex-by-report/vex-by-report.js');
const LIVE = fs.readFileSync(SRC_PATH, 'utf8');

// Brace-matched extraction, so the lift survives the handler growing (or losing)
// a try/catch rather than being pinned to a line count.
function sliceBraced(source, marker) {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  expect(open).toBeGreaterThan(start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
    } else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error('unbalanced braces while slicing ' + marker);
}

// The handler expression itself, with the events-map key stripped off.
function handlerSource(source) {
  const entry = sliceBraced(source, "'click .export-as-vex'");
  return entry.slice(entry.indexOf(':') + 1).trim();
}

// `Meteor` joined this list when the product_id obfuscation secret moved
// server-side: the handler now mints its tokens over CSAF.EncodeModuleIds before
// it can generate anything. A free variable missing from here is not a failing
// assertion, it is a ReferenceError thrown out of every test in the file - so the
// list and the stub world below have to move together.
const FREE_VARS = ['Meteor', 'Template', 'VEX', 'Notify', 'Blob', 'window', 'document', 'getName'];

function compileHandler(source) {
  return new Function(...FREE_VARS, `return (${handlerSource(source)});`);
}

// The real filename builder, lifted too: a stub would let the download assertions
// pass while the button named every file the same.
const getName = (function () {
  return new Function(`${sliceBraced(LIVE, 'function getName(')}\nreturn getName;`)();
})();

// --- the world the handler runs in ------------------------------------------

function makeWorld() {
  const world = {
    loadingCalls: [],
    detailsCalls: [],
    danger: [],
    success: [],
    blobs: [],
    clicked: [],
    vexCalls: [],
    meteorCalls: []
  };

  let loading;
  let details = world.initialDetails;

  const doc = {
    createElement: function () {
      const el = {href: '', download: '', click: function () { world.clicked.push(el); }};
      return el;
    },
    body: {appendChild: function () {}, removeChild: function () {}}
  };

  world.instance = {
    data: {
      // TWO modules on purpose: the ids are what the token mint has to carry,
      // and getName only falls back to the project name when the report covers
      // something other than exactly one module.
      data: {project: {name: 'Some project'}, modules: [{_id: 'm1', name: 'alpha'}, {_id: 'm2', name: 'beta'}]},
      confidenceCurrent: '3'
    },
    loading: {
      set: function (value) { world.loadingCalls.push(value); loading = value; },
      get: function () { return loading; }
    },
    details: {
      set: function (value) { world.detailsCalls.push(value); details = value; },
      get: function () { return details; }
    }
  };

  world.free = {
    Meteor: {
      callAsync: function () {
        world.meteorCalls.push(Array.prototype.slice.call(arguments));
        return world.encodeResult();
      }
    },
    Template: {instance: function () { return world.instance; }},
    VEX: {
      fromVulnerabilityReport: function () {
        world.vexCalls.push(Array.prototype.slice.call(arguments));
        return world.vexResult();
      }
    },
    Notify: {
      danger: function (message) { world.danger.push(message); },
      success: function (message) { world.success.push(message); }
    },
    Blob: function Blob(parts) { world.blobs.push(parts); },
    window: {
      document: doc,
      navigator: {},
      URL: {createObjectURL: function () { return 'blob:stub'; }}
    },
    document: doc,
    getName: getName
  };

  return world;
}

// Drain every pending microtask the handler chain scheduled.
function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

async function runClick(source, vexResult, encodeResult) {
  const world = makeWorld();
  world.vexResult = vexResult;
  world.encodeResult = encodeResult || function () { return Promise.resolve({m1: 'v2:AAA', m2: 'v2:BBB'}); };
  // Resolved BY NAME off FREE_VARS rather than positionally, so adding a free
  // variable cannot silently shift every stub one slot to the left.
  const handler = compileHandler(source).apply(null, FREE_VARS.map(function (name) { return world.free[name]; }));
  world.escaped = null;
  try {
    await handler.call({});
  } catch (error) {
    world.escaped = error;
  }
  await flush();
  return world;
}

const REFUSED = Object.assign(new Error('Access Denied'), {error: 403, reason: 'Access Denied'});

// --- the harness really drives the shipped handler ---------------------------

describe('export-as-csaf: the lifted handler is the shipped one', () => {
  it('generates and downloads on the happy path', async () => {
    const world = await runClick(LIVE, () => Promise.resolve({document: {title: 'advisory'}}));
    expect(world.vexCalls).toHaveLength(1);
    expect(world.detailsCalls).toEqual([{document: {title: 'advisory'}}]);
    expect(world.clicked).toHaveLength(1);
    expect(world.danger).toHaveLength(0);
  });

  it('passes the report data, the confidence, createCSAF=true and the token map', async () => {
    const world = await runClick(LIVE, () => Promise.resolve({}));
    expect(world.vexCalls[0]).toHaveLength(4);
    expect(world.vexCalls[0][0]).toBe(world.instance.data.data);
    expect(world.vexCalls[0][1]).toBe('3');
    expect(world.vexCalls[0][2]).toBe(true);
    expect(world.vexCalls[0][3]).toEqual({m1: 'v2:AAA', m2: 'v2:BBB'});
  });

  it('names the download from the real getName, not from a stub', async () => {
    const world = await runClick(LIVE, () => Promise.resolve({}));
    expect(world.clicked[0].download).toBe('Some project-CSAF.json');
  });

  it('clears the spinner on the happy path', async () => {
    const world = await runClick(LIVE, () => Promise.resolve({}));
    expect(world.loadingCalls).toEqual([true, false]);
  });
});

// --- the tokens are minted server-side, once, before anything is generated ---

// The obfuscation secret no longer ships to the browser, so this button cannot
// compute a product_id itself. It asks the server for the whole set in one call
// and hands the result to the generator.

describe('export-as-csaf: the product_id tokens come from the server', () => {
  it('mints them in exactly ONE CSAF.EncodeModuleIds call carrying every module id', async () => {
    const world = await runClick(LIVE, () => Promise.resolve({}));
    expect(world.meteorCalls).toHaveLength(1);
    expect(world.meteorCalls[0][0]).toBe('CSAF.EncodeModuleIds');
    expect(world.meteorCalls[0][1]).toEqual(['m1', 'm2']);
  });

  it('hands the generator the map the server returned, not one it built itself', async () => {
    const world = await runClick(LIVE, () => Promise.resolve({}),
      () => Promise.resolve({m1: 'v2:ONE', m2: 'v2:TWO'}));
    expect(world.vexCalls[0][3]).toEqual({m1: 'v2:ONE', m2: 'v2:TWO'});
  });

  it('mints BEFORE it generates, so a refused mint costs no generation', async () => {
    const world = await runClick(LIVE, () => Promise.resolve({}), () => Promise.reject(REFUSED));
    expect(world.meteorCalls).toHaveLength(1);
    expect(world.vexCalls).toHaveLength(0);
  });

  it('fails closed when the mint is refused', async () => {
    // Same assertion set as a refused generation: the user is told, the spinner
    // stops and nothing is handed over.
    assertFailedClosed(await runClick(LIVE, () => Promise.resolve({}), () => Promise.reject(REFUSED)));
  });

  it('survives a report covering no modules at all', async () => {
    const world = makeWorld();
    world.instance.data.data.modules = [];
    world.vexResult = () => Promise.resolve({});
    world.encodeResult = () => Promise.resolve({});
    const handler = compileHandler(LIVE).apply(null, FREE_VARS.map((name) => world.free[name]));
    await handler.call({});
    await flush();
    expect(world.meteorCalls[0][1]).toEqual([]);
    expect(world.danger).toHaveLength(0);
  });
});

// --- THE defect --------------------------------------------------------------

// One assertion function, re-run verbatim by every non-vacuity check below.
function assertFailedClosed(world) {
  // The spinner stops. Leaving it set is a button that can never be used again
  // without a page reload.
  expect(world.loadingCalls[world.loadingCalls.length - 1]).toBe(false);
  // The user is told, in the same words the report's own Create CSAF uses.
  expect(world.danger).toHaveLength(1);
  expect(world.danger[0]).toContain('CSAF creation failed');
  // FAIL CLOSED: nothing is handed to the user.
  expect(world.clicked).toHaveLength(0);
  expect(world.blobs).toHaveLength(0);
  // ...and the rejection is handled here rather than escaping as an unhandled one.
  expect(world.escaped).toBeNull();
}

describe('export-as-csaf: a rejected generation fails closed', () => {
  it('toasts, stops the spinner and downloads nothing when CSAF.Create refuses', async () => {
    await assertFailedClosed(await runClick(LIVE, () => Promise.reject(REFUSED)));
  });

  it('surfaces the rejection message rather than a bare "[object Object]"', async () => {
    const world = await runClick(LIVE, () => Promise.reject(REFUSED));
    expect(world.danger[0]).toContain('Access Denied');
  });

  it('handles a rejection that carries no message at all', async () => {
    const world = await runClick(LIVE, () => Promise.reject('upstream is down'));
    expect(world.danger[0]).toContain('upstream is down');
    expect(world.escaped).toBeNull();
  });

  it('never stores a details payload it did not receive', async () => {
    // A details value written on the failure path would make the NEXT click skip
    // generation entirely and download whatever was left behind.
    const world = await runClick(LIVE, () => Promise.reject(REFUSED));
    expect(world.detailsCalls).toEqual([]);
    expect(world.instance.details.get()).toBeUndefined();
  });

  it('would FAIL if the spinner were left set (non-vacuity)', async () => {
    const sabotaged = LIVE.replace(/instance\.loading\.set\(false\)\n(\s*)Notify\.danger/, '$1Notify.danger');
    expect(sabotaged).not.toBe(LIVE);
    const world = await runClick(sabotaged, () => Promise.reject(REFUSED));
    await expect(async () => assertFailedClosed(world)).rejects.toThrow();
  });

  it('would FAIL if the failure path fell through to the download (non-vacuity)', async () => {
    // Drop only the `return`, leaving the toast and the spinner reset in place,
    // so what this proves is specifically that the handler STOPS - not merely
    // that it reports.
    const sabotaged = LIVE.replace(/\n\s*return;\n(\s*)\}\n(\s*)instance\.details\.set\(data\)/,
      '\n$1}\n$2instance.details.set(data)');
    expect(sabotaged).not.toBe(LIVE);
    const world = await runClick(sabotaged, () => Promise.reject(REFUSED));
    await expect(async () => assertFailedClosed(world)).rejects.toThrow();
  });

  it('would FAIL if the toast were dropped (non-vacuity)', async () => {
    const sabotaged = LIVE.replace(/Notify\.danger\('CSAF creation failed: '[^\n]*\n/, '\n');
    expect(sabotaged).not.toBe(LIVE);
    const world = await runClick(sabotaged, () => Promise.reject(REFUSED));
    await expect(async () => assertFailedClosed(world)).rejects.toThrow();
  });
});

// --- the wording is not invented here ----------------------------------------

describe('export-as-csaf: the failure toast reuses the report wording', () => {
  const REPORT_JS = fs.readFileSync(
    path.join(__dirname, '../..', 'imports/client/ui/reports/report-vulnerability/report-vulnerability.js'),
    'utf8'
  );

  it('uses the same "CSAF creation failed: " prefix the report already ships', () => {
    // Two toolbars a few pixels apart must not describe the same 403 in two
    // different ways.
    expect(REPORT_JS).toContain("Notify.danger('CSAF creation failed: '");
    expect(LIVE).toContain("Notify.danger('CSAF creation failed: '");
  });

  it('imports Notify rather than reaching for a global', () => {
    expect(LIVE).toMatch(/import Notify from '\/imports\/api\/notify'/);
  });

  it('keeps the copy free of em-dashes and en-dashes', () => {
    expect(LIVE).not.toMatch(/[\u2013\u2014]/);
  });
});
