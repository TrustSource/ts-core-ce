/* eslint-disable no-undef, no-new-func */
// The CSAF wizard's affected-products / affected-modules checkboxes
// (imports/client/ui/csaf/csaf-create.js) after the product_id obfuscation
// secret moved server-side.
//
// WHAT CHANGED. Those checkboxes used to answer "is this module in the
// document?" by decrypting every stored product_id in the browser
// (VEX.productIdToModuleId) and comparing. The secret that made that possible
// is gone from the client bundle, so the comparison now runs against a
// {token: id} map: filled by ONE CSAF.DecodeProductIds call when a saved
// document opens, and by the CSAF.EncodeModuleIds result when a box is ticked.
//
// Two of the four call sites are Blaze HELPERS, which are synchronous and
// cannot await anything - which is the whole reason the map is a module-scoped
// ReactiveVar rather than a promise threaded through the handlers.
//
// csaf-create.js imports meteor/* and cannot be required under Jest, so this
// file uses the lift-and-execute technique of vex-by-report-export.unit.spec.js:
// the module-level helpers, the two change handlers and the two isChecked
// helpers are cut out of the real source and run against stubs. Source locks
// would only prove the code is shaped right; these prove it behaves right.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const SRC_PATH = path.join(REPO, 'imports/client/ui/csaf/csaf-create.js');
const LIVE = fs.readFileSync(SRC_PATH, 'utf8');

// ---------------------------------------------------------------------------
// The lift
// ---------------------------------------------------------------------------

// Brace-matched extraction, so a lift survives its function growing or losing a
// branch rather than being pinned to a line count.
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

// An object-literal entry (`'click .x': function () {}` / `isChecked: fn`) with
// its key stripped off, leaving the bare function expression.
function entrySource(source, marker) {
  const entry = sliceBraced(source, marker);
  return entry.slice(entry.indexOf(':') + 1).trim();
}

function helperSource(source, ownerMarker, name) {
  return entrySource(sliceBraced(source, ownerMarker), name + ': function');
}

function lineDeclaring(source, prefix) {
  const line = source.split('\n').find((candidate) => candidate.trim().startsWith(prefix));
  expect(line).toBeDefined();
  return line;
}

// Everything the lifted code reaches for that is genuinely external to it.
const FREE_VARS = ['Meteor', 'Notify', 'Session', 'Products', 'Projects', 'VEX', 'ReactiveVar',
  'Template', 'getNestedValue'];

// The module-level helpers the handlers and the two helpers share. Lifted rather
// than re-implemented here: a copy in the spec would keep passing after the real
// ones changed.
const LIFTED = [
  'function productIdOf(',
  'function lookupModuleId(',
  'function moduleIdFromProductId(',
  'function getProjectBranches(',
  'function ensureProjectBranches(',
  'function isModuleChecked(',
  'function rememberProductId(',
  'function resetProductIdMap(',
  'function collectProductIds(',
  'function loadProductIdMap(',
  'function encodeSelectedId(',
  'function csafErrorText('
];

function compileModule(source) {
  const parts = [
    lineDeclaring(source, 'const TREE_BRANCHES'),
    lineDeclaring(source, 'const productIdMap'),
    lineDeclaring(source, 'let _decodedDocumentId')
  ].concat(LIFTED.map((marker) => sliceBraced(source, marker)));

  const api = [
    'return {',
    '  onModulesChange: ' + entrySource(source, "'change .affected_modules'") + ',',
    '  onProductsChange: ' + entrySource(source, "'change .affected_products'") + ',',
    '  isCheckedWizard: ' + helperSource(source, 'Template.csafCreate.helpers', 'isChecked') + ',',
    '  isCheckedListItem: ' + helperSource(source, 'Template.affeactedProductListItem.helpers', 'isChecked') + ',',
    '  resetProductIdMap: resetProductIdMap,',
    '  loadProductIdMap: loadProductIdMap,',
    '  readMap: function () { return productIdMap.get(); }',
    '};'
  ].join('\n');

  return new Function(...FREE_VARS, parts.join('\n') + '\n' + api);
}

// ---------------------------------------------------------------------------
// The world the lifted code runs in
// ---------------------------------------------------------------------------

function makeWorld(source) {
  const world = {
    meteorCalls: [],
    vexCalls: [],
    danger: [],
    success: [],
    jsonDataSets: [],
    mapReads: 0
  };

  world.encodeResult = function (ids) {
    const map = {};
    ids.forEach((id) => { map[id] = 'v2:token-for-' + id; });
    return Promise.resolve(map);
  };
  world.decodeResult = function () { return Promise.resolve({}); };

  world.doc = null;
  world.session = {
    company: {name: 'Acme'},
    modulesByProject: [
      {_id: 'm1', name: 'alpha', version: '1.0.0'},
      {_id: 'm2', name: 'beta', version: '2.0.0'},
      {_id: 'm3', name: 'gamma', version: '3.0.0'}
    ]
  };
  world.projects = {
    prj1: {_id: 'prj1', name: 'Project A'},
    prj2: {_id: 'prj2', name: 'Project B'}
  };
  world.products = {
    p1: {_id: 'p1', name: 'Widget', version: '1.0.0'},
    p2: {_id: 'p2', name: 'Gadget', version: '2.0.0'},
    parent: {_id: 'parent', name: 'Suite'}
  };

  function FakeReactiveVar(initial) {
    let value = initial;
    this.get = function () { world.mapReads += 1; return value; };
    this.set = function (next) { value = next; };
  }

  world.instance = {
    jsonData: {
      get: function () { return world.doc; },
      set: function (next) { world.jsonDataSets.push(next); world.doc = next; }
    }
  };

  const free = {
    Meteor: {
      callAsync: function (name, arg) {
        world.meteorCalls.push([name, arg]);
        if (name === 'CSAF.EncodeModuleIds') { return world.encodeResult(arg); }
        if (name === 'CSAF.DecodeProductIds') { return world.decodeResult(arg); }
        return Promise.resolve();
      }
    },
    Notify: {
      danger: function (message) { world.danger.push(message); },
      success: function (message) { world.success.push(message); }
    },
    Session: {get: function (key) { return world.session[key]; }},
    Products: {findOne: function (id) { return world.products[id]; }},
    Projects: {findOne: function (id) { return world.projects[id]; }},
    VEX: {
      moduleToProductVersion: function (module, productId) {
        world.vexCalls.push([module, productId]);
        return Promise.resolve({
          category: 'product_version',
          name: module.version,
          product: {name: module.name, product_id: productId}
        });
      }
    },
    ReactiveVar: FakeReactiveVar,
    Template: {
      instance: function () {
        return {
          jsonData: world.instance.jsonData,
          data: {jsonData: world.doc, currentStep: 3}
        };
      }
    },
    getNestedValue: function (obj, keyPath) {
      if (typeof obj !== 'object' || obj === null) { throw new TypeError('Object must be a non-null object'); }
      return keyPath.split('.').reduce(function (node, key) {
        return node && node[/^\d+$/.test(key) ? parseInt(key, 10) : key];
      }, obj);
    }
  };

  world.api = compileModule(source).apply(null, FREE_VARS.map((name) => free[name]));
  return world;
}

// Drain every pending microtask the lifted chain scheduled.
function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function checkboxEvent(value, checked) {
  return {currentTarget: {type: 'checkbox', value: value, checked: checked}};
}

function moduleBranch(name, token) {
  return {category: 'product_version', name: name, product: {name: name, product_id: token}};
}

function makeDocument(projectBranches) {
  return {
    document: {title: 'Project CSAF document'},
    product_tree: {
      branches: [{category: 'vendor', name: 'Acme', branches: projectBranches}]
    }
  };
}

function projectBranch(name, modules) {
  return {category: 'product_name', name: name, branches: modules};
}

function branchesOf(doc, projectName) {
  const projects = doc.product_tree.branches[0].branches;
  const project = projects.find((item) => item.name === projectName);
  return project && project.branches;
}

// ===========================================================================
// Criterion 30 - the client holds no decryptor any more
// ===========================================================================

describe('AC30 no client file can turn a product_id back into a module id', () => {
  function clientFiles() {
    const found = [];
    (function walk(dir) {
      fs.readdirSync(dir, {withFileTypes: true}).forEach(function (entry) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.js$/.test(entry.name)) {
          found.push(full);
        }
      });
    })(path.join(REPO, 'imports/client'));
    return found;
  }

  it('finds a client tree to scan at all', () => {
    expect(clientFiles().length).toBeGreaterThan(100);
  });

  it.each([['VEX.productIdToModuleId'], ['VEX.moduleIdToProductId']])(
    'no file under imports/client/ calls %s',
    (token) => {
      const offenders = clientFiles().filter((file) => fs.readFileSync(file, 'utf8').includes(token));
      expect(offenders).toEqual([]);
    });

  it('leaves no bare CryptoJS reach-around in csaf-create.js either', () => {
    expect(LIVE).not.toMatch(/crypto-js/);
  });

  it('both isChecked helpers resolve their comparison through the shared map reader', () => {
    // Neither may grow its own private comparison: isModuleChecked is the one
    // place that reads the ReactiveVar, so the two tabs cannot disagree.
    const wizard = helperSource(LIVE, 'Template.csafCreate.helpers', 'isChecked');
    const listItem = helperSource(LIVE, 'Template.affeactedProductListItem.helpers', 'isChecked');
    expect(wizard).toContain('isModuleChecked(');
    expect(listItem).toContain('isModuleChecked(');
  });
});

// ===========================================================================
// Criterion 31 - one bulk decode per opened document, then reactive ticks
// ===========================================================================

describe('AC31 opening a saved document decodes its tokens once', () => {
  const OLD = 'v2:storedOne';
  const NEW = 'v2:brandNewTwo';

  function openedWorld() {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([
      projectBranch('Project A', [moduleBranch('1.0.0', OLD), moduleBranch('2.0.0', NEW)]),
      projectBranch('Project B', [moduleBranch('3.0.0', OLD)])
    ]);
    world.decodeResult = function () { return Promise.resolve({[OLD]: 'm1', [NEW]: 'm2'}); };
    return world;
  }

  it('issues exactly ONE CSAF.DecodeProductIds call, carrying the DISTINCT tokens', async () => {
    const world = openedWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.meteorCalls).toHaveLength(1);
    expect(world.meteorCalls[0][0]).toBe('CSAF.DecodeProductIds');
    // OLD appears in two branches and must be asked about once.
    expect(world.meteorCalls[0][1]).toEqual([OLD, NEW]);
  });

  it('does not re-issue the call when the route data churns for the same document', async () => {
    const world = openedWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.meteorCalls).toHaveLength(1);
  });

  it('ticks every box the document covers once the decode lands, with no interaction', async () => {
    const world = openedWorld();
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeFalsy();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeTruthy();
    expect(world.api.isCheckedWizard('Project A', 'm2')).toBeTruthy();
    expect(world.api.isCheckedWizard('Project B', 'm1')).toBeTruthy();
  });

  it('leaves a module the document does not carry unticked', async () => {
    const world = openedWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.isCheckedWizard('Project A', 'm3')).toBeFalsy();
    expect(world.api.isCheckedWizard('Project B', 'm2')).toBeFalsy();
  });

  it('reads the ReactiveVar on EVERY helper run, so Blaze reruns it when the map lands', async () => {
    // The whole reason the map is a ReactiveVar. A helper that short-circuits
    // before reading it registers no dependency and stays stale until a reload.
    const world = openedWorld();
    const before = world.mapReads;
    world.api.isCheckedWizard('Project A', 'm1');
    expect(world.mapReads).toBeGreaterThan(before);
    const mid = world.mapReads;
    // ...including for a project name that is not in the document at all.
    world.api.isCheckedWizard('No Such Project', 'm1');
    expect(world.mapReads).toBeGreaterThan(mid);
  });

  it('asks about nothing when the document carries no branches', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([]);
    world.api.loadProductIdMap('doc-empty', world.doc);
    await flush();
    expect(world.meteorCalls).toEqual([]);
  });

  it('asks about nothing for a brand new document', async () => {
    const world = makeWorld(LIVE);
    world.api.loadProductIdMap(undefined, undefined);
    await flush();
    expect(world.meteorCalls).toEqual([]);
    expect(world.danger).toEqual([]);
  });

  it('drops the tokens the server would not resolve rather than storing a null', async () => {
    const world = openedWorld();
    world.decodeResult = function () { return Promise.resolve({[OLD]: 'm1', [NEW]: null}); };
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.readMap()).toEqual({[OLD]: 'm1'});
    expect(world.api.isCheckedWizard('Project A', 'm2')).toBeFalsy();
  });

  it('never ticks a box for a token whose decoded value is null (a foreign or stale id)', async () => {
    const world = openedWorld();
    world.decodeResult = function () { return Promise.resolve({[OLD]: null, [NEW]: null}); };
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeFalsy();
    expect(world.api.isCheckedWizard('Project A', 'm2')).toBeFalsy();
  });

  it('the list-item helper answers from the same map as the wizard helper', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([projectBranch('Suite', [moduleBranch('1.0.0', NEW)])]);
    world.decodeResult = function () { return Promise.resolve({[NEW]: 'p1'}); };
    expect(world.api.isCheckedListItem('Suite', 'p1')).toBeFalsy();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.isCheckedListItem('Suite', 'p1')).toBeTruthy();
    expect(world.api.isCheckedListItem('Suite', 'p2')).toBeFalsy();
  });

  it('the list-item helper tolerates a missing data context', () => {
    const world = makeWorld(LIVE);
    world.doc = null;
    expect(() => world.api.isCheckedListItem('Suite', 'p1')).not.toThrow();
    expect(world.api.isCheckedListItem('Suite', 'p1')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Risk 5, the reverse of criterion 33: a decode failure looks like data loss
// ---------------------------------------------------------------------------

describe('AC31 a failed decode is reported, not silently swallowed', () => {
  const TOKEN = 'v2:someToken';

  function failingWorld(rejection) {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([projectBranch('Project A', [moduleBranch('1.0.0', TOKEN)])]);
    world.decodeResult = function () { return Promise.reject(rejection); };
    return world;
  }

  it('toasts when the bulk decode is refused', async () => {
    const world = failingWorld(Object.assign(new Error('Access Denied [403]'), {reason: 'Access Denied'}));
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.danger).toHaveLength(1);
    expect(world.danger[0]).toContain('Access Denied');
  });

  it('handles a rejection carrying no reason at all', async () => {
    const world = failingWorld('upstream is down');
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.danger[0]).toContain('upstream is down');
  });

  it('leaves the stored document untouched, so a save cannot write the failure back', async () => {
    const world = failingWorld(new Error('nope'));
    const before = JSON.stringify(world.doc);
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(JSON.stringify(world.doc)).toBe(before);
    // ...and nothing was pushed through jsonData.set either.
    expect(world.jsonDataSets).toEqual([]);
  });

  it('performs no encode on open, so the stored product_id values cannot be rewritten', async () => {
    // AC36: encrypt() uses a fresh IV per call, so re-encoding on load would
    // silently rewrite every product_id in the document.
    const world = failingWorld(new Error('nope'));
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.meteorCalls.map((call) => call[0])).toEqual(['CSAF.DecodeProductIds']);
  });
});

// ===========================================================================
// Criterion 36 - opening a stored document must not rewrite its product_ids
//
// The block above pins this only on the FAILING decode path, where an encode
// could not have happened anyway. On the SUCCESS path nothing asserted document
// identity, so a load that re-encoded every token - keeping the map consistent
// and every checkbox correct - would have gone unnoticed. Since encrypt() mints a
// fresh IV per call, that would silently rewrite every product_id in a stored
// advisory on nothing more than opening it.
// ===========================================================================

describe('AC36 opening a stored document leaves every product_id byte-identical', () => {
  const STORED = 'v2:storedOne';
  const MODERN = 'v2:brandNewTwo';
  const STORED_TWO = 'v2:storedThree';

  function storedWorld() {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([
      projectBranch('Project A', [moduleBranch('1.0.0', STORED), moduleBranch('2.0.0', MODERN)]),
      projectBranch('Project B', [moduleBranch('3.0.0', STORED_TWO)])
    ]);
    world.decodeResult = function () {
      return Promise.resolve({[STORED]: 'm1', [MODERN]: 'm2', [STORED_TWO]: 'm3'});
    };
    return world;
  }

  it('the document is byte-identical after a SUCCESSFUL open', async () => {
    const world = storedWorld();
    const before = JSON.stringify(world.doc);
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(JSON.stringify(world.doc)).toBe(before);
    expect(world.jsonDataSets).toEqual([]);
  });

  it('NON-VACUITY: the open really did succeed and populate the map', async () => {
    // Without this, the identity assertion above would also pass for a build where
    // loadProductIdMap did nothing at all.
    const world = storedWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.readMap()).toEqual({[STORED]: 'm1', [MODERN]: 'm2', [STORED_TWO]: 'm3'});
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeTruthy();
    expect(world.api.isCheckedWizard('Project B', 'm3')).toBeTruthy();
  });

  it('each token is still the exact string that was stored, in its original branch', async () => {
    const world = storedWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(branchesOf(world.doc, 'Project A').map((b) => b.product.product_id))
      .toEqual([STORED, MODERN]);
    expect(branchesOf(world.doc, 'Project B').map((b) => b.product.product_id))
      .toEqual([STORED_TWO]);
  });

  it('a successful open issues the decode and NOTHING else - no encode, ever', async () => {
    const world = storedWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.meteorCalls.map((call) => call[0])).toEqual(['CSAF.DecodeProductIds']);
    expect(world.vexCalls).toEqual([]);
  });

  it('re-opening the same document, and reading every helper, still rewrites nothing', async () => {
    // Blaze reruns the helpers on every reactive change; none of those runs may
    // touch the document.
    const world = storedWorld();
    const before = JSON.stringify(world.doc);
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    ['m1', 'm2', 'm3'].forEach((id) => {
      world.api.isCheckedWizard('Project A', id);
      world.api.isCheckedWizard('Project B', id);
    });
    await flush();
    expect(JSON.stringify(world.doc)).toBe(before);
    expect(world.meteorCalls).toHaveLength(1);
  });

  it('NON-VACUITY: this harness CAN see a document write when one happens', async () => {
    // A tick after the open does change the document and does call the encode -
    // so the identity assertions above are observing restraint, not blindness.
    const world = storedWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    const afterOpen = JSON.stringify(world.doc);
    // m3 is not in Project A (it is in Project B), so ticking it really appends.
    await world.api.onModulesChange(checkboxEvent('prj1_m_m3', true), world.instance);
    await flush();
    expect(JSON.stringify(world.doc)).not.toBe(afterOpen);
    expect(world.jsonDataSets).toHaveLength(1);
    expect(world.meteorCalls.map((call) => call[0]))
      .toEqual(['CSAF.DecodeProductIds', 'CSAF.EncodeModuleIds']);
  });
});

// ===========================================================================
// Criterion 32 - ticking a box mints exactly one token
// ===========================================================================

describe('AC32 ticking a module asks the server for exactly that one token', () => {
  it('calls CSAF.EncodeModuleIds with the single id and writes the token into the branch', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([]);
    const event = checkboxEvent('prj1_m_m1', true);
    await world.api.onModulesChange(event, world.instance);
    expect(world.meteorCalls).toHaveLength(1);
    expect(world.meteorCalls[0]).toEqual(['CSAF.EncodeModuleIds', ['m1']]);
    const branches = branchesOf(world.doc, 'Project A');
    expect(branches).toHaveLength(1);
    expect(branches[0].product.product_id).toBe('v2:token-for-m1');
  });

  it('hands the minted token to VEX rather than letting VEX compute one', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([]);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', true), world.instance);
    expect(world.vexCalls).toHaveLength(1);
    expect(world.vexCalls[0][0]._id).toBe('m1');
    expect(world.vexCalls[0][1]).toBe('v2:token-for-m1');
  });

  it('writes the token into the map too, so the box stays ticked with no further call', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([]);
    const event = checkboxEvent('prj1_m_m1', true);
    await world.api.onModulesChange(event, world.instance);
    expect(event.currentTarget.checked).toBe(true);
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeTruthy();
    expect(world.meteorCalls).toHaveLength(1);
  });

  it('does the same for a product on the Products tab', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([]);
    const event = checkboxEvent('parent_m_p1', true);
    await world.api.onProductsChange(event, world.instance);
    expect(world.meteorCalls).toEqual([['CSAF.EncodeModuleIds', ['p1']]]);
    expect(branchesOf(world.doc, 'Suite')[0].product.product_id).toBe('v2:token-for-p1');
    expect(world.api.isCheckedListItem('Suite', 'p1')).toBeTruthy();
  });

  it('files a second module under the project branch it already created', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([]);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', true), world.instance);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m2', true), world.instance);
    expect(world.doc.product_tree.branches[0].branches).toHaveLength(1);
    expect(branchesOf(world.doc, 'Project A')).toHaveLength(2);
  });

  it('keeps two projects apart', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([]);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', true), world.instance);
    await world.api.onModulesChange(checkboxEvent('prj2_m_m2', true), world.instance);
    expect(branchesOf(world.doc, 'Project A')).toHaveLength(1);
    expect(branchesOf(world.doc, 'Project B')).toHaveLength(1);
    expect(world.api.isCheckedWizard('Project A', 'm2')).toBeFalsy();
    expect(world.api.isCheckedWizard('Project B', 'm2')).toBeTruthy();
  });
});

// ===========================================================================
// Criterion 33 - a refused mint leaves no checked box backed by nothing
// ===========================================================================

describe('AC33 a refused mint unticks the box and writes nothing', () => {
  function refusingWorld(doc) {
    const world = makeWorld(LIVE);
    world.doc = doc;
    world.encodeResult = function () {
      return Promise.reject(Object.assign(new Error('Access Denied [403]'), {reason: 'Access Denied'}));
    };
    return world;
  }

  it('unticks the checkbox, toasts, and adds no branch', async () => {
    const world = refusingWorld(makeDocument([]));
    const before = JSON.stringify(world.doc);
    const event = checkboxEvent('prj1_m_m1', true);
    await world.api.onModulesChange(event, world.instance);
    expect(event.currentTarget.checked).toBe(false);
    expect(world.danger).toHaveLength(1);
    expect(world.danger[0]).toContain('Access Denied');
    expect(JSON.stringify(world.doc)).toBe(before);
  });

  it('adds no project scaffolding either, so the document is byte-identical', async () => {
    // The vendor branch and the empty project branch are branches too: a
    // half-built tree left behind by a refused mint would be saved with the
    // document.
    const world = refusingWorld(makeDocument([]));
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', true), world.instance);
    expect(JSON.stringify(world.doc)).toBe(before);
    expect(world.jsonDataSets).toEqual([]);
  });

  it('leaves an existing document completely alone', async () => {
    const world = refusingWorld(makeDocument([projectBranch('Project B', [moduleBranch('2.0.0', 'v2:kept')])]));
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', true), world.instance);
    expect(JSON.stringify(world.doc)).toBe(before);
  });

  it('never calls VEX at all, so nothing can be built without a token', async () => {
    const world = refusingWorld(makeDocument([]));
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', true), world.instance);
    expect(world.vexCalls).toEqual([]);
  });

  it('leaves the box unticked to the helper as well', async () => {
    const world = refusingWorld(makeDocument([]));
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', true), world.instance);
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeFalsy();
  });

  it('treats a reply that carries no token for the id as a refusal', async () => {
    // A 200 with an empty map is not success: product_id would be undefined and
    // the advisory would carry a branch nobody can resolve.
    const world = makeWorld(LIVE);
    world.doc = makeDocument([]);
    world.encodeResult = function () { return Promise.resolve({}); };
    const event = checkboxEvent('prj1_m_m1', true);
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(event, world.instance);
    expect(event.currentTarget.checked).toBe(false);
    expect(world.danger).toHaveLength(1);
    expect(world.vexCalls).toEqual([]);
    expect(JSON.stringify(world.doc)).toBe(before);
  });

  it('does the same on the Products tab', async () => {
    const world = refusingWorld(makeDocument([]));
    const event = checkboxEvent('parent_m_p1', true);
    const before = JSON.stringify(world.doc);
    await world.api.onProductsChange(event, world.instance);
    expect(event.currentTarget.checked).toBe(false);
    expect(world.danger).toHaveLength(1);
    expect(JSON.stringify(world.doc)).toBe(before);
  });
});

// ===========================================================================
// Criterion 34 - unticking removes exactly one branch, or none
// ===========================================================================

describe('AC34 unticking removes the matching branch and nothing else', () => {
  const T1 = 'v2:one';
  const T2 = 'v2:two';

  async function openedWorld() {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([
      projectBranch('Project A', [moduleBranch('1.0.0', T1), moduleBranch('2.0.0', T2)])
    ]);
    world.decodeResult = function () { return Promise.resolve({[T1]: 'm1', [T2]: 'm2'}); };
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    return world;
  }

  it('removes exactly the branch whose product_id maps to that id', async () => {
    const world = await openedWorld();
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', false), world.instance);
    const branches = branchesOf(world.doc, 'Project A');
    expect(branches).toHaveLength(1);
    expect(branches[0].product.product_id).toBe(T2);
  });

  it('drops the project branch once its last module is gone', async () => {
    const world = await openedWorld();
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', false), world.instance);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m2', false), world.instance);
    expect(world.doc.product_tree.branches[0].branches).toEqual([]);
  });

  it('makes no server call at all to untick', async () => {
    const world = await openedWorld();
    const before = world.meteorCalls.length;
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', false), world.instance);
    expect(world.meteorCalls).toHaveLength(before);
  });

  // THE regression this criterion exists for.
  it('removes NOTHING on a map miss, rather than the LAST branch', async () => {
    // findIndex returns -1 and the previous code spliced at -1, which takes out
    // the final element. With the map now able to miss - a token that failed to
    // decode, or a document opened while the decode was still in flight - that
    // silently deleted a product the user never touched.
    const world = makeWorld(LIVE);
    world.doc = makeDocument([
      projectBranch('Project A', [moduleBranch('1.0.0', T1), moduleBranch('2.0.0', T2)])
    ]);
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', false), world.instance);
    expect(JSON.stringify(world.doc)).toBe(before);
    expect(branchesOf(world.doc, 'Project A')).toHaveLength(2);
  });

  it('removes nothing when the project branch is not in the document', async () => {
    const world = await openedWorld();
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(checkboxEvent('prj2_m_m2', false), world.instance);
    expect(JSON.stringify(world.doc)).toBe(before);
  });

  it('removes nothing when the document has no product_tree yet', async () => {
    const world = makeWorld(LIVE);
    world.doc = {document: {title: 'New document'}};
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', false), world.instance);
    expect(JSON.stringify(world.doc)).toBe(before);
  });

  it('holds on the Products tab too', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([
      projectBranch('Suite', [moduleBranch('1.0.0', T1), moduleBranch('2.0.0', T2)])
    ]);
    const before = JSON.stringify(world.doc);
    await world.api.onProductsChange(checkboxEvent('parent_m_p1', false), world.instance);
    expect(JSON.stringify(world.doc)).toBe(before);

    world.decodeResult = function () { return Promise.resolve({[T1]: 'p1', [T2]: 'p2'}); };
    world.api.loadProductIdMap('doc-p', world.doc);
    await flush();
    await world.api.onProductsChange(checkboxEvent('parent_m_p1', false), world.instance);
    expect(branchesOf(world.doc, 'Suite')).toHaveLength(1);
    expect(branchesOf(world.doc, 'Suite')[0].product.product_id).toBe(T2);
  });
});

// ---------------------------------------------------------------------------
// Non-vacuity: the lift really drives the shipped code
// ---------------------------------------------------------------------------

// Real mutations of the real source, run through the SAME assertions, which must
// then fail. Without these the lift could be quietly extracting the wrong thing
// and every test above would stay green.

describe('the harness would catch the defects it claims to catch', () => {
  it('AC34 would FAIL without the findIndex guard (the splice(-1, 1) regression)', async () => {
    const sabotaged = LIVE.replace(/if\(moduleIndex === -1\)\{[\s\S]*?\}/g, '');
    expect(sabotaged).not.toBe(LIVE);
    const world = makeWorld(sabotaged);
    world.doc = makeDocument([
      projectBranch('Project A', [moduleBranch('1.0.0', 'v2:one'), moduleBranch('2.0.0', 'v2:two')])
    ]);
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', false), world.instance);
    // The last branch is gone, which is exactly the bug.
    expect(JSON.stringify(world.doc)).not.toBe(before);
    expect(branchesOf(world.doc, 'Project A')).toHaveLength(1);
  });

  it('AC33 would FAIL if a refused mint fell through to the tree', async () => {
    const sabotaged = LIVE.replace(/if\(!token\)\{[\s\S]*?\}/g, '');
    expect(sabotaged).not.toBe(LIVE);
    const world = makeWorld(sabotaged);
    world.doc = makeDocument([]);
    world.encodeResult = function () { return Promise.reject(new Error('Access Denied')); };
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', true), world.instance);
    expect(JSON.stringify(world.doc)).not.toBe(before);
  });

  it('AC31 would FAIL without the once-per-document guard', async () => {
    const sabotaged = LIVE.replace(/if\(_decodedDocumentId === key\)\{[\s\S]*?\}/, '');
    expect(sabotaged).not.toBe(LIVE);
    const world = makeWorld(sabotaged);
    world.doc = makeDocument([projectBranch('Project A', [moduleBranch('1.0.0', 'v2:one')])]);
    world.api.loadProductIdMap('doc-a', world.doc);
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.meteorCalls).toHaveLength(2);
  });
});

// ===========================================================================
// Criterion 35 - the map belongs to one document at a time
// ===========================================================================

describe('AC35 the map is cleared per document', () => {
  const TOKEN_A = 'v2:belongsToA';

  async function withDocumentA() {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([projectBranch('Project A', [moduleBranch('1.0.0', TOKEN_A)])]);
    world.decodeResult = function () { return Promise.resolve({[TOKEN_A]: 'm1'}); };
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeTruthy();
    return world;
  }

  it('drops document A tokens the moment document B is opened', async () => {
    const world = await withDocumentA();
    world.decodeResult = function () { return Promise.resolve({}); };
    // Document B happens to carry the same token value. It must not tick until
    // B's own decode says so.
    world.doc = makeDocument([projectBranch('Project A', [moduleBranch('1.0.0', TOKEN_A)])]);
    world.api.loadProductIdMap('doc-b', world.doc);
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeFalsy();
    await flush();
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeFalsy();
  });

  it('drops them for a brand new document too', async () => {
    const world = await withDocumentA();
    world.api.loadProductIdMap(undefined, undefined);
    expect(world.api.readMap()).toEqual({});
  });

  it('resetProductIdMap clears the map and re-arms the once-per-document guard', async () => {
    const world = await withDocumentA();
    world.api.resetProductIdMap();
    expect(world.api.readMap()).toEqual({});
    // Re-opening the SAME document after a reset must decode again, or a second
    // visit in the same session would render every box unticked.
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.meteorCalls).toHaveLength(2);
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeTruthy();
  });

  it('a late reply for document A cannot populate the map while B is open', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([projectBranch('Project A', [moduleBranch('1.0.0', TOKEN_A)])]);
    let releaseA;
    world.decodeResult = function () {
      return new Promise(function (resolve) { releaseA = resolve; });
    };
    world.api.loadProductIdMap('doc-a', world.doc);
    // B opens before A's decode settles.
    world.decodeResult = function () { return Promise.resolve({}); };
    world.api.loadProductIdMap('doc-b', world.doc);
    releaseA({[TOKEN_A]: 'm1'});
    await flush();
    expect(world.api.readMap()).toEqual({});
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeFalsy();
  });

  it('a late FAILURE for document A cannot toast over document B', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([projectBranch('Project A', [moduleBranch('1.0.0', TOKEN_A)])]);
    let rejectA;
    world.decodeResult = function () {
      return new Promise(function (resolve, reject) { rejectA = reject; });
    };
    world.api.loadProductIdMap('doc-a', world.doc);
    world.decodeResult = function () { return Promise.resolve({}); };
    world.api.loadProductIdMap('doc-b', world.doc);
    rejectA(new Error('too late'));
    await flush();
    expect(world.danger).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The lifecycle wiring the lift cannot execute
// ---------------------------------------------------------------------------

describe('AC35 the template lifecycle clears the map as well', () => {
  function hookBody(marker) {
    const start = LIVE.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return LIVE.slice(start, LIVE.indexOf('\n});', start));
  }

  it.each([
    ['Template.csafCreate.onCreated'],
    ['Template.csafCreate.onDestroyed']
  ])('%s resets the token map', (marker) => {
    expect(hookBody(marker)).toContain('resetProductIdMap()');
  });

  it('the onRendered autorun feeds loadProductIdMap the document it just parsed', () => {
    const body = hookBody('Template.csafCreate.onRendered');
    expect(body).toContain('loadProductIdMap(');
    // Reached from the autorun, so an _id change re-arms it.
    expect(body.indexOf('this.autorun')).toBeLessThan(body.indexOf('loadProductIdMap('));
  });

  it('has exactly one loadProductIdMap call site', () => {
    expect(LIVE.match(/loadProductIdMap\(/g)).toHaveLength(2); // the declaration and the one call
  });
});

// ===========================================================================
// Security review finding 5 - a token spelling __proto__ is data, not a prototype
//
// product_id values come out of an UPLOADED CSAF document, so a token can be the
// literal string '__proto__'. Assigned as a key of a plain {} it sets the
// prototype instead of creating an own property: the write is a silent no-op,
// every later hasOwnProperty check answers false, and a read of a key that is
// missing hands back something off Object.prototype instead of undefined. The
// backend fixed its two response maps in 12d042f0f; this is the client residue.
// ===========================================================================

describe('finding 5 a product_id of __proto__ is an ordinary key', () => {
  const PROTO = '__proto__';
  const PLAIN = 'v2:ordinary';

  // A literal {'__proto__': x} sets the prototype rather than creating a key, so
  // the fixtures build their replies the way the server and the wire do: through
  // Object.fromEntries / JSON.parse, both of which create a real own property.
  function reply(pairs) {
    return Object.fromEntries(pairs);
  }

  function protoWorld() {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([
      projectBranch('Project A', [moduleBranch('1.0.0', PROTO), moduleBranch('2.0.0', PLAIN)]),
      projectBranch('Project B', [moduleBranch('3.0.0', PROTO)])
    ]);
    world.decodeResult = function () { return Promise.resolve(reply([[PROTO, 'm1'], [PLAIN, 'm2']])); };
    return world;
  }

  it('the fixture really does carry an OWN __proto__ key', () => {
    // Without this the tests below could be asserting against an object that
    // never had the property at all, and would pass for any implementation.
    const built = reply([[PROTO, 'm1']]);
    expect(Object.keys(built)).toEqual([PROTO]);
    expect(Object.prototype.hasOwnProperty.call(built, PROTO)).toBe(true);
    expect(built[PROTO]).toBe('m1');
    expect(Object.keys(JSON.parse('{"__proto__":"m1"}'))).toEqual([PROTO]);
  });

  it('asks the server about a repeated __proto__ token exactly once', async () => {
    const world = protoWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.meteorCalls).toHaveLength(1);
    expect(world.meteorCalls[0][1]).toEqual([PROTO, PLAIN]);
  });

  it('does not inflate one repeated token into a batch the server refuses', async () => {
    // The backend caps a decode batch at CSAF_ID_BATCH_MAX (1000) and rejects
    // anything larger with a 400, so a document that de-duplicates to one token
    // but is sent as 1200 would come back as an error and leave the whole page
    // unticked.
    const world = makeWorld(LIVE);
    const branches = [];
    for (let i = 0; i < 1200; i += 1) {
      branches.push(moduleBranch(i + '.0.0', PROTO));
    }
    world.doc = makeDocument([projectBranch('Project A', branches)]);
    world.decodeResult = function () { return Promise.resolve(reply([[PROTO, 'm1']])); };
    world.api.loadProductIdMap('doc-big', world.doc);
    await flush();
    expect(world.meteorCalls[0][1]).toEqual([PROTO]);
    expect(world.meteorCalls[0][1].length).toBeLessThanOrEqual(1000);
    expect(world.danger).toEqual([]);
  });

  it('ticks every box whose stored token is __proto__ once the decode lands', async () => {
    const world = protoWorld();
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeFalsy();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeTruthy();
    expect(world.api.isCheckedWizard('Project B', 'm1')).toBeTruthy();
  });

  it('resolves the ordinary token in the same document and keeps both entries', async () => {
    const world = protoWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.isCheckedWizard('Project A', 'm2')).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(world.api.readMap(), PROTO)).toBe(true);
    expect(world.api.readMap()[PROTO]).toBe('m1');
  });

  it('the list-item helper resolves it too', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([projectBranch('Suite', [moduleBranch('1.0.0', PROTO)])]);
    world.decodeResult = function () { return Promise.resolve(reply([[PROTO, 'p1']])); };
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    expect(world.api.isCheckedListItem('Suite', 'p1')).toBeTruthy();
    expect(world.api.isCheckedListItem('Suite', 'p2')).toBeFalsy();
  });

  it('keeps the __proto__ entry when the next tick rebuilds the map', async () => {
    // The map is copied into a fresh object on every mint, so a copy through a
    // plain {} loses exactly this entry and unticks a box the user never
    // touched.
    const world = protoWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    await world.api.onModulesChange(checkboxEvent('prj1_m_m3', true), world.instance);
    expect(world.api.isCheckedWizard('Project A', 'm3')).toBeTruthy();
    expect(world.api.isCheckedWizard('Project A', 'm1')).toBeTruthy();
    expect(world.api.isCheckedWizard('Project B', 'm1')).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(world.api.readMap(), PROTO)).toBe(true);
  });

  it('unticking a __proto__ branch still removes exactly that branch', async () => {
    const world = protoWorld();
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    await world.api.onModulesChange(checkboxEvent('prj1_m_m1', false), world.instance);
    expect(branchesOf(world.doc, 'Project A').map((b) => b.product.product_id)).toEqual([PLAIN]);
    expect(branchesOf(world.doc, 'Project B').map((b) => b.product.product_id)).toEqual([PROTO]);
  });

  it('a token the reply never resolved ticks nothing, however it is named', async () => {
    const world = makeWorld(LIVE);
    world.doc = makeDocument([
      projectBranch('Project A', [moduleBranch('1.0.0', 'constructor'), moduleBranch('2.0.0', 'toString')])
    ]);
    world.decodeResult = function () { return Promise.resolve({}); };
    world.api.loadProductIdMap('doc-a', world.doc);
    await flush();
    ['m1', 'm2', 'm3'].forEach((id) => {
      expect(world.api.isCheckedWizard('Project A', id)).toBeFalsy();
    });
  });

  it('a mint that answers with no token for a __proto__ id is still a refusal', async () => {
    // Modules carry no schema, so a module _id is client-chosen within a tenant
    // and the id side of the encode reply can be spelled __proto__ as well.
    // Read off a plain object a missing key yields Object.prototype, which is
    // truthy: the tick would survive and a branch would be written with an
    // object where its product_id belongs.
    const world = makeWorld(LIVE);
    world.session.modulesByProject.push({_id: PROTO, name: 'proto', version: '9.9.9'});
    world.doc = makeDocument([]);
    world.encodeResult = function () { return Promise.resolve({}); };
    const event = checkboxEvent('prj1_m___proto__', true);
    const before = JSON.stringify(world.doc);
    await world.api.onModulesChange(event, world.instance);
    expect(event.currentTarget.checked).toBe(false);
    expect(world.danger).toHaveLength(1);
    expect(world.vexCalls).toEqual([]);
    expect(JSON.stringify(world.doc)).toBe(before);
  });

  it('NON-VACUITY: that same id mints normally when the reply does carry it', async () => {
    const world = makeWorld(LIVE);
    world.session.modulesByProject.push({_id: PROTO, name: 'proto', version: '9.9.9'});
    world.doc = makeDocument([]);
    world.encodeResult = function (ids) {
      return Promise.resolve(reply(ids.map((id) => [id, 'v2:token-for-' + id])));
    };
    await world.api.onModulesChange(checkboxEvent('prj1_m___proto__', true), world.instance);
    expect(world.danger).toEqual([]);
    expect(branchesOf(world.doc, 'Project A')[0].product.product_id).toBe('v2:token-for-__proto__');
    expect(world.api.isCheckedWizard('Project A', PROTO)).toBeTruthy();
  });
});

// ===========================================================================
// Criterion 37 - the client cannot reach the server-side codec
// ===========================================================================

describe('AC37 csaf-create.js stays on the client side of the boundary', () => {
  it('imports nothing from imports/server/', () => {
    expect(LIVE).not.toMatch(/from\s+'[^']*\/server\//);
    expect(LIVE).not.toMatch(/require\(\s*'[^']*\/server\//);
  });

  it('imports no csaf interactor barrel (it re-exports the server-only remove.js)', () => {
    expect(LIVE).not.toMatch(/from\s+'\/imports\/lib\/interactors\/csaf'/);
  });
});

// ---------------------------------------------------------------------------
// House style
// ---------------------------------------------------------------------------

describe('the writing rule holds for everything this change touched', () => {
  it.each([
    ['imports/client/ui/csaf/csaf-create.js'],
    ['imports/client/ui/common/vex-by-report/vex-by-report.js'],
    ['imports/client/ui/reports/report-vulnerability/report-vulnerability.js']
  ])('%s contains no em-dash or en-dash', (rel) => {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    expect(src).not.toContain('\u2014');
    expect(src).not.toContain('\u2013');
  });
});
