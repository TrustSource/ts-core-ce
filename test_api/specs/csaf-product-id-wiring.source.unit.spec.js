/* eslint-disable no-undef */
// CSAF product_id: the wiring guards.
//
// The whole point of this change is that the obfuscation secret stops being
// shipped to the browser. Nothing in a Jest run touches the client bundle, so the
// guarantee has to be locked structurally: vex.js holds no crypto, the literal
// lives in exactly one server file, the methods are registered ungated and behind
// the DDP auth gate, and - the one that survives refactors - NO file under
// imports/client/ can transitively reach ANY file under imports/server/.
//
// Source-assertion pattern: the source files are read as strings.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// Comment-blind assertions would happily pass on a commented-out import.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function listJs(dir) {
  const out = [];
  (function walk(current) {
    fs.readdirSync(current, {withFileTypes: true}).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        out.push(full);
      }
    });
  })(dir);
  return out;
}

const VEX_JS = 'imports/lib/converter/vex.js';
const CODEC_JS = 'imports/server/csaf/productIdCodec.js';
const BINDING_JS = 'imports/server/csaf/productId.js';
const METHODS_JS = 'imports/server/csaf/productIdMethods.js';
const OWNERSHIP_JS = 'imports/server/csaf/ownership.js';
const STARTUP_JS = 'imports/startup/server/csaf.js';
const REMOVE_JS = 'imports/lib/interactors/csaf/remove.js';

// ---------------------------------------------------------------------------
// AC9: vex.js holds no crypto at all
// ---------------------------------------------------------------------------

describe('AC9: imports/lib/converter/vex.js is crypto-free', () => {
  const raw = read(VEX_JS);
  const live = stripComments(raw);

  it('imports no crypto-js module of any kind, commented out or otherwise', () => {
    // Raw, not comment-stripped: a commented-out `import CRYPTO from
    // 'crypto-js/rabbit'` is an invitation to put it back.
    expect(raw).not.toContain('crypto-js');
  });

  it('has no CRYPTO / ENCUTF8 identifier left', () => {
    expect(live).not.toMatch(/\bCRYPTO\b/);
    expect(live).not.toMatch(/\bENCUTF8\b/);
    expect(live).not.toMatch(/\bCRYPTO_SECRET\b/);
  });

  it('neither defines nor exports moduleIdToProductId / productIdToModuleId', () => {
    expect(live).not.toMatch(/function\s+moduleIdToProductId/);
    expect(live).not.toMatch(/function\s+productIdToModuleId/);
    expect(live).not.toMatch(/\bmoduleIdToProductId\b/);
    expect(live).not.toMatch(/\bproductIdToModuleId\b/);
  });

  it('still exports the three functions callers depend on', () => {
    expect(live).toMatch(/fromVulnerabilityReport:\s*fromVulnerabilityReport/);
    expect(live).toMatch(/moduleToProductVersion:\s*moduleToProductVersion/);
    expect(live).toMatch(/vulnerabilityToCVE:\s*vulnerabilityToCVE/);
  });

  it('never reaches into imports/server/ (it is bundled to the browser)', () => {
    expect(raw).not.toContain('/imports/server/');
  });
});

// ---------------------------------------------------------------------------
// The codec must stay requirable from Jest, and must not re-declare 'v2:'
// ---------------------------------------------------------------------------

describe('the codec is a pure CommonJS module with the version prefix injected', () => {
  const live = stripComments(read(CODEC_JS));

  it('imports neither meteor/* nor imports/lib/crypto (both would break the Jest require)', () => {
    expect(live).not.toContain('meteor/');
    expect(live).not.toContain('/imports/lib/crypto');
    expect(live).not.toContain('Npm.require');
  });

  it('exports through module.exports (CommonJS), like companySecretFields.js', () => {
    expect(live).toMatch(/module\.exports\s*=/);
    expect(live).not.toMatch(/^\s*export\s/m);
  });

  it('takes versionPrefix as a dependency and never hard-codes a second copy of v2:', () => {
    expect(live).toMatch(/versionPrefix/);
    expect(live).not.toContain("'v2:'");
    expect(live).not.toContain('"v2:"');
  });
});

describe('both product_id methods are rate limited', () => {
  // Security review finding 1. Both methods are reachable by any authenticated
  // user with no role check and no feature gate, and both drive per-element
  // cipher work on a single-threaded server. The batch cap and the element-length
  // cap bound ONE call; only a rate limit bounds how often a caller can make it.
  const live = stripComments(read('imports/startup/server/rate-limit.js'));

  function ruleFor(methodName) {
    // The whole addRule call that mentions the method, so the assertions below are
    // about one rule rather than about the file containing the words somewhere.
    const rules = live.split('DDPRateLimiter.addRule(').slice(1);
    return rules.find((rule) => rule.includes(methodName));
  }

  it('registers a DDPRateLimiter rule covering CSAF.EncodeModuleIds', () => {
    expect(ruleFor('CSAF.EncodeModuleIds')).toBeDefined();
  });

  it('registers a DDPRateLimiter rule covering CSAF.DecodeProductIds', () => {
    expect(ruleFor('CSAF.DecodeProductIds')).toBeDefined();
  });

  it('the rule is scoped and bounded, in the shape of the other CPU-bound rules', () => {
    const rule = ruleFor('CSAF.DecodeProductIds');
    expect(rule).toMatch(/type:\s*'method'/);
    expect(rule).toMatch(/connectionId\(\)\s*\{\s*return true;\s*\}/);
    // A rule with no numeric limit arguments is registered but enforces nothing.
    expect(rule).toMatch(/\},\s*\d+,\s*\d+/);
  });

  it('rate-limit.js is actually loaded by the server startup', () => {
    // Non-vacuity: a rule in a file nothing imports throttles nothing.
    const startup = stripComments(read('imports/startup/server/index.js'));
    expect(startup).toMatch(/rate-limit/);
  });
});

describe('the binding wires the real crypto.js primitives in', () => {
  const live = stripComments(read(BINDING_JS));

  it('imports encryptFor, decryptFor and VERSION_PREFIX from crypto.js', () => {
    expect(live).toMatch(/import\s*\{[^}]*\bencryptFor\b[^}]*\}\s*from\s*'\/imports\/lib\/crypto'/);
    expect(live).toMatch(/import\s*\{[^}]*\bdecryptFor\b[^}]*\}\s*from\s*'\/imports\/lib\/crypto'/);
    expect(live).toMatch(/import\s*\{[^}]*\bVERSION_PREFIX\b[^}]*\}\s*from\s*'\/imports\/lib\/crypto'/);
  });

  // Security review finding 3: the credential key must not also mint product_ids.
  it('does NOT import the bare credential pair - a product_id is a different data set', () => {
    const imported = live.match(/import\s*\{([^}]*)\}\s*from\s*'\/imports\/lib\/crypto'/);
    expect(imported).not.toBeNull();
    const names = imported[1].split(',').map((name) => name.trim());
    expect(names).not.toContain('encrypt');
    expect(names).not.toContain('decrypt');
  });

  it('keys the codec on a domain constant, passed to BOTH directions', () => {
    // Both, not one: encrypting under the subkey while decrypting under the
    // credential key (or the reverse) would break every token instead of
    // separating them, and would be invisible to a source check on one side.
    expect(live).toMatch(/const\s+KEY_DOMAIN\s*=\s*'[^']+'/);
    expect(live).toMatch(/encrypt:\s*\(\s*\w+\s*\)\s*=>\s*encryptFor\(KEY_DOMAIN,/);
    expect(live).toMatch(/decrypt:\s*\(\s*\w+\s*\)\s*=>\s*decryptFor\(KEY_DOMAIN,/);
  });

  it('crypto.js derives the subkey the way it already derives the blind-index key', () => {
    // One derivation function, so the CSAF subkey and the HMAC subkey cannot drift
    // into two different constructions - and so getHmacKey keeps producing the
    // byte-identical value that every stored keyHash was matched against.
    const cryptoSrc = stripComments(read('imports/lib/crypto.js'));
    expect(cryptoSrc).toMatch(/function getKey\(domain\)\s*\{\s*return deriveKey\(resolveSecret\(\), domain\);\s*\}/);
    expect(cryptoSrc).toMatch(/domain \? `\$\{secret\}\|\$\{domain\}` : secret/);
    expect(cryptoSrc).toMatch(/const HMAC_DOMAIN = 'hmac-v1';/);
    expect(cryptoSrc).toMatch(/function getHmacKey\(\)\s*\{\s*return getKey\(HMAC_DOMAIN\);\s*\}/);
    // decryptFor must not log per failure: it is reachable in bulk from a DDP
    // method, so request content would otherwise drive the log volume.
    const decryptFor = cryptoSrc.slice(cryptoSrc.indexOf('export function decryptFor'));
    expect(decryptFor).not.toContain('console.log');
  });

  it('passes VERSION_PREFIX into the codec rather than a hand-copied literal', () => {
    expect(live).toMatch(/versionPrefix:\s*VERSION_PREFIX/);
    expect(live).not.toContain("'v2:'");
    expect(live).not.toMatch(/const\s+VERSION_PREFIX\s*=/);
  });

  it('crypto.js really exports VERSION_PREFIX (an unexported one would be silently undefined)', () => {
    expect(stripComments(read('imports/lib/crypto.js')))
      .toMatch(/export const VERSION_PREFIX = 'v2:';/);
  });

  it('exports the three entry points the callers use, all built by the codec', () => {
    expect(live).toMatch(/export const encodeProductId = codec\.encodeProductId/);
    expect(live).toMatch(/export const decodeProductId = codec\.decodeProductId/);
    expect(live).toMatch(/export const encodeIdMap = codec\.encodeIdMap/);
  });

  it('re-implements none of them - the binding is thin', () => {
    // A second implementation here would be invisible to the Jest suite, which can
    // only require the codec.
    expect(live).not.toMatch(/^\s*(export\s+)?function\s/m);
  });
});

describe('the pure method handlers stay Meteor-free', () => {
  const live = stripComments(read(METHODS_JS));

  it('imports no meteor package and builds no Meteor.Error itself', () => {
    expect(live).not.toContain('meteor/');
    expect(live).not.toContain('Meteor.Error');
  });

  it('raises every failure through the injected error factory', () => {
    expect(live).toMatch(/deps\.error\(400,/);
    expect(live).toMatch(/deps\.error\(403,/);
    expect(live).toMatch(/deps\.error\(500,/);
  });

  it('interpolates the cap into its message from the single declaration', () => {
    expect(live).toMatch(/const CSAF_ID_BATCH_MAX = 1000;/);
    expect(live).toMatch(/max \$\{CSAF_ID_BATCH_MAX\}/);
    // A second hard-coded 1000 in a message would drift the moment the cap moved.
    expect(live).not.toMatch(/max 1000\)/);
  });
});

// ---------------------------------------------------------------------------
// AC11: the new vex.js signatures
// ---------------------------------------------------------------------------

describe('AC11: the published vex.js signatures take the tokens from their caller', () => {
  const live = stripComments(read(VEX_JS));

  it('fromVulnerabilityReport takes productIds in slot 4', () => {
    expect(live).toMatch(
      /async function fromVulnerabilityReport\(\{company, project, modules, list\}, confidenceCurrent, createCSAF, productIds\)/);
  });

  it('moduleToProductVersion gains a 2nd productId parameter', () => {
    expect(live).toMatch(/async function moduleToProductVersion\(module, productId\)/);
  });

  it('vulnerabilityToCVE keeps its parameter positions (csaf-create.js calls it positionally)', () => {
    expect(live).toMatch(
      /function vulnerabilityToCVE\(vulnerability, component, details, cryptoMap, productIds, cweMap\)/);
  });

  it('no longer builds a local cryptoMap - the caller\'s map goes straight through', () => {
    expect(live).not.toMatch(/const\s+cryptoMap\s*=\s*\{\}/);
    expect(live).toMatch(/vulnerabilityToCVE\(vulnerability, component, cveDetail, productIds,/);
  });

  it('compacts the per-path lookup so an unmapped moduleId cannot enter product_ids', () => {
    expect(live).toMatch(/_\.uniq\(_\.compact\(_\.map\(paths/);
  });
});

// ---------------------------------------------------------------------------
// AC27: remove.js decodes through the server codec
// ---------------------------------------------------------------------------

describe('AC27: imports/lib/interactors/csaf/remove.js uses the server codec', () => {
  const live = stripComments(read(REMOVE_JS));

  it('has no VEX import and no productIdToModuleId call left', () => {
    expect(live).not.toMatch(/from\s*'\/imports\/lib\/converter\/vex'/);
    expect(live).not.toContain('productIdToModuleId');
    expect(live).not.toMatch(/\bVEX\b/);
  });

  it('imports decodeProductId from the server codec', () => {
    expect(live).toMatch(/import\s*\{[^}]*decodeProductId[^}]*\}\s*from\s*'\/imports\/server\/csaf\/productId'/);
    expect(live).toContain('decodeProductId(');
  });

  it('drops the tokens it could not decode instead of passing them on', () => {
    // unmuteVulnerability does an unscoped Modules.findOneAsync and openRisk stamps
    // the caller's companyId onto whatever moduleId it is handed; an undefined or
    // garbage id must never reach either.
    //
    // Pinned to THIS filter, not to `/\.filter\(/`: remove.js has a third,
    // unrelated `.filter(k => params[k] === true)` in its log line, so the loose
    // pattern stayed green with both security filters deleted.
    // The behaviour itself is exercised in csaf-tenant-scope.unit.spec.js, which
    // runs this block with an ownership lookup that grants everything - so the
    // decode guard is the only thing left holding.
    expect(live).toMatch(/\.filter\(\s*moduleId\s*=>\s*typeof moduleId === 'string' && moduleId !== ''\s*\)/);
    expect(live).toMatch(/\.filter\(\s*moduleId\s*=>\s*ownedModuleIds\.has\(moduleId\)\s*\)/);
  });

  it('AC29: scopes the decoded ids with the MODULE-only ownership lookup', () => {
    expect(live).toMatch(/import\s*\{[^}]*filterOwnedModuleIds[^}]*\}\s*from\s*'\/imports\/server\/csaf\/ownership'/);
    // Not filterOwnedIds: this path writes into Modules, so a product id of the
    // caller's own company must not satisfy it.
    expect(live).not.toMatch(/\bfilterOwnedIds\b/);
    expect(live).toMatch(/filterOwnedModuleIds\([\s\S]{0,200}user\.profile\.companyId\)/);
  });
});

// ---------------------------------------------------------------------------
// AC24/AC25: registration is ungated, but still behind the DDP auth gate
// ---------------------------------------------------------------------------

describe('AC24: every CSAF method is registered WITHOUT a feature gate', () => {
  const live = stripComments(read(STARTUP_JS));

  function methodLine(name) {
    const match = new RegExp(`'${name}':[^\\n]*`).exec(live);
    expect(match).not.toBeNull();
    return match[0];
  }

  it.each(['CSAF.EncodeModuleIds', 'CSAF.DecodeProductIds', 'CSAF.Create', 'CSAF.Remove',
    'CSAF.Validate', 'CSAF.Update', 'CSAF.CreateOrUpdate'])('%s is not wrapped in gatedByFeature', (name) => {
    expect(methodLine(name)).not.toContain('gatedByFeature');
  });

  it('NON-VACUITY: gatedByFeature is not referenced anywhere in this file, so the assertions above are not vacuous', () => {
    expect(live).not.toMatch(/\bgatedByFeature\b/);
  });

  it('derives the company from the logged-in user, never from an argument', () => {
    expect(live).toMatch(/Meteor\.userAsync\(\)/);
    expect(live).not.toMatch(/'CSAF\.(Encode|Decode)[^']*':\s*(async\s*)?function\s*\([^)]*companyId/);
  });

  it('binds a real Meteor.Error factory, so the contract error codes survive DDP', () => {
    // A plain Error thrown from a method surfaces to the client as a 500 and every
    // 400/403 in the contract collapses into it.
    expect(live).toMatch(/new Meteor\.Error\(/);
  });
});

describe('AC25: neither method is allowlisted past the DDP authentication gate', () => {
  const guard = read('imports/startup/server/security-guard.js');
  const publicBlock = guard.slice(
    guard.indexOf('const PUBLIC_METHODS = new Set(['),
    guard.indexOf(']);', guard.indexOf('const PUBLIC_METHODS = new Set([')));

  it.each(['CSAF.EncodeModuleIds', 'CSAF.DecodeProductIds'])('%s is absent from PUBLIC_METHODS', (name) => {
    expect(publicBlock).not.toContain(name);
  });

  it('NON-VACUITY: the block really is the allowlist (it contains the login entries)', () => {
    expect(publicBlock).toContain("'login'");
    expect(publicBlock).toContain("'createUser'");
  });
});

// ---------------------------------------------------------------------------
// Server generator calls the codec in-process
// ---------------------------------------------------------------------------

describe('the server generator encodes in-process and passes the map in', () => {
  it.each([
    ['publicVexKey.getFile', 'imports/server/collections/companies.js']
  ])('%s imports encodeIdMap and hands it to fromVulnerabilityReport', (_name, rel) => {
    const live = stripComments(read(rel));
    expect(live).toMatch(/import\s*\{[^}]*encodeIdMap[^}]*\}\s*from\s*'\/imports\/server\/csaf\/productId'/);
    expect(live).toMatch(/VEX\.fromVulnerabilityReport\([^)]*productIds\)/);
  });
});

// ---------------------------------------------------------------------------
// AC30: no client file reaches for the removed VEX crypto helpers
// ---------------------------------------------------------------------------

describe('AC30: nothing under imports/client/ references the removed VEX crypto helpers', () => {
  const clientFiles = listJs(path.join(REPO, 'imports/client'));

  it('found client files to scan (non-vacuity)', () => {
    expect(clientFiles.length).toBeGreaterThan(100);
  });

  it('no VEX.productIdToModuleId / VEX.moduleIdToProductId anywhere', () => {
    const offenders = clientFiles.filter((file) => {
      const src = fs.readFileSync(file, 'utf8');
      return src.includes('productIdToModuleId') || src.includes('moduleIdToProductId');
    }).map((file) => path.relative(REPO, file));
    expect(offenders).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// AC37 (as corrected): the transitive import-graph guard.
//
// Broadened from "no client file imports productId.js" to "no client file reaches
// ANY file under imports/server/". As originally written the guard would have
// missed productIdCodec.js - the file that actually holds the secret.
// ---------------------------------------------------------------------------

const SPEC_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

function specifiersOf(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const found = new Set();
  SPEC_PATTERNS.forEach((pattern) => {
    pattern.lastIndex = 0;
    let match = pattern.exec(src);
    while (match) {
      found.add(match[1]);
      match = pattern.exec(src);
    }
  });
  return [...found];
}

// Meteor's own resolution: '/imports/x' is repo-absolute, './x' is relative,
// everything else is a Meteor or npm package and leaves the repo graph.
function resolveSpecifier(fromFile, spec) {
  let base;
  if (spec.startsWith('/')) {
    base = path.join(REPO, spec.slice(1));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
  return candidates.find((candidate) =>
    fs.existsSync(candidate) && fs.statSync(candidate).isFile() && candidate.endsWith('.js')) || null;
}

// BFS from `roots`, returning {parents, visited}. `parents` lets a violation be
// reported as the actual chain rather than as a bare "somewhere".
function walkGraph(roots) {
  const parents = new Map();
  const queue = [];
  roots.forEach((root) => {
    if (!parents.has(root)) {
      parents.set(root, null);
      queue.push(root);
    }
  });
  while (queue.length) {
    const current = queue.shift();
    specifiersOf(current).forEach((spec) => {
      const target = resolveSpecifier(current, spec);
      if (target && !parents.has(target)) {
        parents.set(target, current);
        queue.push(target);
      }
    });
  }
  return parents;
}

function chainTo(parents, file) {
  const chain = [];
  let node = file;
  while (node) {
    chain.unshift(path.relative(REPO, node));
    node = parents.get(node);
  }
  return chain.join('\n  -> ');
}

describe('AC37: no file under imports/client/ can transitively reach imports/server/', () => {
  const clientRoots = listJs(path.join(REPO, 'imports/client'));
  const parents = walkGraph(clientRoots);
  const serverDir = path.join(REPO, 'imports/server') + path.sep;

  it('the walk actually resolved a real graph (non-vacuity)', () => {
    // It must have followed edges out of imports/client/ into shared code, or the
    // "nothing reaches the server" result below would be true for the wrong reason.
    expect(parents.size).toBeGreaterThan(clientRoots.length);
    const vex = path.join(REPO, VEX_JS);
    expect(parents.has(vex)).toBe(true);
    expect(parents.get(vex)).not.toBeNull();
  });

  it('the walk CAN detect a server edge when one exists (self-check on the barrel)', () => {
    // imports/lib/interactors/csaf/index.js re-exports remove.js, which now imports
    // the codec. Seeding the same walk there must find the path - proving a client
    // file importing that barrel would be caught, not silently missed.
    const barrel = path.join(REPO, 'imports/lib/interactors/csaf/index.js');
    const fromBarrel = walkGraph([barrel]);
    const reached = [...fromBarrel.keys()].filter((file) => file.startsWith(serverDir));
    expect(reached.map((file) => path.relative(REPO, file).split(path.sep).join('/')))
      .toContain(BINDING_JS);
  });

  it('reaches no file under imports/server/ from any client file', () => {
    const violations = [...parents.keys()]
      .filter((file) => file.startsWith(serverDir))
      .map((file) => chainTo(parents, file));
    expect(violations).toEqual([]);
  });

  it('reaches neither the codec nor the binding in particular', () => {
    expect(parents.has(path.join(REPO, CODEC_JS))).toBe(false);
    expect(parents.has(path.join(REPO, BINDING_JS))).toBe(false);
    expect(parents.has(path.join(REPO, METHODS_JS))).toBe(false);
    expect(parents.has(path.join(REPO, OWNERSHIP_JS))).toBe(false);
  });

  it('no client file imports the imports/lib/interactors/csaf barrel', () => {
    const offenders = listJs(path.join(REPO, 'imports/client'))
      .filter((file) => specifiersOf(file).some((spec) => /interactors\/csaf'?$/.test(spec)))
      .map((file) => path.relative(REPO, file));
    expect(offenders).toEqual([]);
  });

  it('csaf-import-modal.js keeps importing .../csaf/create directly, bypassing the barrel', () => {
    expect(stripComments(read('imports/client/ui/csaf/csaf-import-modal.js')))
      .toContain("'/imports/lib/interactors/csaf/create'");
  });
});
