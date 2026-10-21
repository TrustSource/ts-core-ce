/* eslint-disable no-undef, no-new-func */
// The Import CSAF modal (imports/client/ui/csaf/csaf-import-modal.js).
//
// WHAT WAS BROKEN, IN BOTH DIRECTIONS. The modal called
//
//     CSAFCreate({file: fileJson, name: fileName}, function () { ...success... })
//
// but imports/lib/interactors/csaf/create.js takes a SINGLE destructured
// argument and returns a promise. It has never accepted a callback. So:
//
//   * on SUCCESS the second argument was silently discarded - no success toast,
//     the modal never hid, and the `loadingInProgress` Session key was never
//     cleared. A successful import left the dialog open under a stuck spinner.
//   * on FAILURE the returned promise was never awaited, so the try/catch around
//     the call could not see the rejection (it is thrown a tick later). The
//     failure surfaced as an unhandled rejection, with the same stuck dialog.
//
// The module imports meteor/* and cannot be required under Jest, so this file
// LIFTS the real validateAndImportCsaf out of the source and EXECUTES it against
// stubs. That is what makes the two directions above assertable at all: a source
// lock could see the shape of the call but never that the toast fires.
//
// The interactor itself is deliberately NOT touched by the fix - its signature is
// the correct one, and it is asserted here so the two cannot drift apart again.
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '../..', 'imports/client/ui/csaf/csaf-import-modal.js');
const LIVE = fs.readFileSync(SRC_PATH, 'utf8');
const CREATE_SRC = fs.readFileSync(
  path.join(__dirname, '../..', 'imports/lib/interactors/csaf/create.js'),
  'utf8'
);

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

// Every module-level function declaration, lifted together so the importer can
// call whatever failure helper it factored out. Declarations hoist, so order in
// the lifted blob does not matter.
function liftFunctions(source) {
  return [...source.matchAll(/^function (\w+)\(/gm)]
    .map((match) => sliceBraced(source, `function ${match[1]}(`))
    .join('\n\n');
}

const FREE_VARS = ['Meteor', 'CSAFCreate', 'Notify', '$', 'Session', 'MODAL', 'LOADING', 'console'];

function compileImporter(source) {
  return new Function(...FREE_VARS, `${liftFunctions(source)}\nreturn validateAndImportCsaf;`);
}

// --- the world the importer runs in ------------------------------------------

function makeWorld(options) {
  const world = {
    validateCalls: [],
    createCalls: [],
    success: [],
    danger: [],
    sessionSets: [],
    modalCalls: [],
    selectors: []
  };

  const jquery = function (selector) {
    world.selectors.push(selector);
    return {
      modal: function (action) { world.modalCalls.push({selector, action}); }
    };
  };

  world.free = [
    {
      callAsync: function (name, args) {
        world.validateCalls.push({name, args});
        return options.validate();
      }
    },
    function CSAFCreate() {
      world.createCalls.push(Array.prototype.slice.call(arguments));
      return options.create();
    },
    {
      success: function (message) { world.success.push(message); },
      danger: function (message) { world.danger.push(message); }
    },
    jquery,
    {
      set: function () { world.sessionSets.push(Array.prototype.slice.call(arguments)); }
    },
    '#CSAFImportModal',
    'loadingInProgress',
    {log: function () {}}
  ];

  return world;
}

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

const VALID_JSON = JSON.stringify({document: {title: 'An advisory'}});

async function runImport(source, options) {
  const world = makeWorld(options);
  const importer = compileImporter(source)(...world.free);
  world.escaped = null;
  try {
    importer(options.content === undefined ? VALID_JSON : options.content, 'advisory.json');
  } catch (error) {
    world.escaped = error;
  }
  await flush();
  await flush();
  return world;
}

const ok = () => Promise.resolve();
const refused = () => Promise.reject(Object.assign(new Error('Access Denied'), {
  error: 403,
  reason: 'Access Denied'
}));

// --- the contract the modal has to call ---------------------------------------

describe('CSAF import: the interactor takes one argument and returns a promise', () => {
  it('csaf/create.js destructures a SINGLE argument', () => {
    // The root cause: a second callback argument has nowhere to land.
    expect(CREATE_SRC).toMatch(/const create = async function \(\{[^}]*\}\)/);
  });

  it('csaf/create.js declares no callback parameter', () => {
    const signature = /const create = async function \(([\s\S]*?)\) \{/.exec(CREATE_SRC);
    expect(signature).not.toBeNull();
    expect(signature[1]).not.toMatch(/callback|cb\b|done/);
  });

  it('is an async function, so every caller has a promise to handle', () => {
    expect(CREATE_SRC).toContain('async function');
  });
});

// --- the harness really drives the shipped importer ---------------------------

describe('CSAF import: the lifted importer is the shipped one', () => {
  it('validates the raw file content before parsing it', async () => {
    const world = await runImport(LIVE, {validate: ok, create: ok});
    expect(world.validateCalls).toHaveLength(1);
    expect(world.validateCalls[0].name).toBe('CSAF.Validate');
    expect(world.validateCalls[0].args).toEqual({file: VALID_JSON});
  });

  it('hands the interactor the PARSED document and the file name', async () => {
    const world = await runImport(LIVE, {validate: ok, create: ok});
    expect(world.createCalls).toHaveLength(1);
    expect(world.createCalls[0][0]).toEqual({
      file: {document: {title: 'An advisory'}},
      name: 'advisory.json'
    });
  });
});

// --- THE defect, direction 1: a SUCCESSFUL import ------------------------------

function assertSuccessCompleted(world) {
  // The toast the user is owed.
  expect(world.success).toEqual(['File successfully uploaded.']);
  // The dialog closes.
  expect(world.modalCalls).toEqual([{selector: '#CSAFImportModal', action: 'hide'}]);
  // The spinner stops: Session.set(LOADING) with no value CLEARS the key.
  expect(world.sessionSets).toContainEqual(['loadingInProgress']);
  // ...and nothing reported a failure that did not happen.
  expect(world.danger).toEqual([]);
}

describe('CSAF import: a successful import finishes the dialog', () => {
  it('toasts, hides the modal and clears the loading flag', async () => {
    await assertSuccessCompleted(await runImport(LIVE, {validate: ok, create: ok}));
  });

  it('calls the interactor with exactly ONE argument', async () => {
    // The defect in one assertion. A second (callback) argument is accepted by
    // JavaScript and dropped by the interactor, which is why this failed
    // silently rather than loudly.
    const world = await runImport(LIVE, {validate: ok, create: ok});
    expect(world.createCalls[0]).toHaveLength(1);
  });

  it('would FAIL if the success continuation were passed as a second argument (non-vacuity)', async () => {
    // The exact shape that shipped: the continuation goes in as argument two and
    // the promise is dropped on the floor.
    const sabotaged = LIVE.replace(
      /CSAFCreate\(\{file: fileJson, name: fileName\}\)\.then\(/,
      'CSAFCreate({file: fileJson, name: fileName}, '
    );
    expect(sabotaged).not.toBe(LIVE);
    const world = await runImport(sabotaged, {validate: ok, create: ok});
    await expect(async () => assertSuccessCompleted(world)).rejects.toThrow();
  });

  it('would FAIL if the toast were dropped (non-vacuity)', async () => {
    const sabotaged = LIVE.replace(/Notify\.success\('File successfully uploaded\.'\);/, '');
    expect(sabotaged).not.toBe(LIVE);
    const world = await runImport(sabotaged, {validate: ok, create: ok});
    await expect(async () => assertSuccessCompleted(world)).rejects.toThrow();
  });

  it('would FAIL if the modal were left open (non-vacuity)', async () => {
    const sabotaged = LIVE.replace(/\$\(MODAL\)\.modal\('hide'\);/, '');
    expect(sabotaged).not.toBe(LIVE);
    const world = await runImport(sabotaged, {validate: ok, create: ok});
    await expect(async () => assertSuccessCompleted(world)).rejects.toThrow();
  });
});

// --- THE defect, direction 2: a REJECTED import --------------------------------

function assertFailureReported(world) {
  // The user is told something went wrong...
  expect(world.danger).toHaveLength(1);
  expect(world.danger[0]).toContain('Access Denied');
  // ...the spinner stops...
  expect(world.sessionSets).toContainEqual(['loadingInProgress']);
  // ...the dialog stays open so the file can be re-picked, and is NOT reported
  // as a success...
  expect(world.success).toEqual([]);
  expect(world.modalCalls).toEqual([]);
  // ...and the rejection is handled rather than escaping.
  expect(world.escaped).toBeNull();
}

describe('CSAF import: a rejected import is reported, not swallowed', () => {
  it('toasts the reason and clears the loading flag when the server refuses', async () => {
    await assertFailureReported(await runImport(LIVE, {validate: ok, create: refused}));
  });

  it('would FAIL if the create rejection were left unhandled (non-vacuity)', async () => {
    // The pre-fix behaviour: no rejection handler at all on the create promise.
    const sabotaged = LIVE.replace(/\}\)\.catch\(reportImportFailure\);/, '});');
    expect(sabotaged).not.toBe(LIVE);
    const world = await runImport(sabotaged, {validate: ok, create: () => Promise.resolve()});
    // Re-run the SAME assertion against a run that cannot report anything.
    await expect(async () => assertFailureReported(world)).rejects.toThrow();
  });
});

// --- the paths that already worked must keep working ---------------------------

describe('CSAF import: the pre-existing failure paths are unchanged', () => {
  it('reports a schema validation failure and clears the loading flag', async () => {
    const world = await runImport(LIVE, {
      validate: () => Promise.reject(new Error('document/tracking is required')),
      create: ok
    });
    expect(world.danger).toEqual(['document/tracking is required']);
    expect(world.sessionSets).toContainEqual(['loadingInProgress']);
    expect(world.createCalls).toEqual([]);
    expect(world.escaped).toBeNull();
  });

  it('reports unparseable JSON that somehow got past validation', async () => {
    const world = await runImport(LIVE, {validate: ok, create: ok, content: 'not json at all'});
    expect(world.danger).toHaveLength(1);
    expect(world.danger[0]).toContain('could not upload file');
    expect(world.createCalls).toEqual([]);
    expect(world.sessionSets).toContainEqual(['loadingInProgress']);
    expect(world.escaped).toBeNull();
  });

  it('keeps the copy free of em-dashes and en-dashes', () => {
    expect(LIVE).not.toMatch(/[\u2013\u2014]/);
  });
});
