/* eslint-disable no-undef */
// Static-source regression for slow approval creation - gap-closing companion to
// approves-create-generation.unit.spec.js.
//
// The sibling spec proves the high-level refactor shape (background flag, two
// phases, stage order, terminal writes). This spec closes the remaining contract
// gaps it did NOT assert:
//   1. the EXACT initial `generation` shape stamped at insert (the contract's
//      pending baseline: status, all 3 stages, current/startedAt/finishedAt/error);
//   2. that the background vs synchronous modes are TWO DISTINCT branches gated
//      on `if (background)` (the headline fast-return AC - the background branch
//      must NOT await phase-2, the synchronous branch must);
//   3. the error path persists a GENERIC, user-facing message in
//      `generation.error` (Finding-1 hardening) while `safeMessage` keeps raw
//      detail server-log-only (retained, but never feeding the banner);
//   4. the REST endpoint (rest-api/approves.js) builds its Approves.Create
//      payload WITHOUT a `background` flag, so REST stays synchronous + complete.
//
// Source-text assertions (no Meteor import) so the jest harness runs serverless,
// mirroring approves-create-scope.unit.spec.js. Live behaviour is covered by
// approves-generation.spec.js / approves-generation-rest.integration.spec.js.
const fs = require('fs');
const path = require('path');

function readStripped(rel) {
  const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  // Strip comments so assertions match real code, not documentation.
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const createCode = readStripped('../../imports/lib/interactors/approves/create.js');
const restCode = readStripped('../../imports/server/rest-api/approves.js');

describe('#79 create.js - exact initial `generation` shape (pending baseline)', () => {
  // Isolate the initialGeneration() factory body so the assertions describe the
  // baseline stamped on the doc, not the later per-stage $set patches.
  const initMatch = createCode.match(/function initialGeneration\s*\(\)\s*\{([\s\S]*?)\n\}/);

  it('defines an initialGeneration() factory used in the inserted doc', () => {
    expect(initMatch).not.toBeNull();
    // The doc must reference the factory (generation present at insert time).
    expect(createCode).toMatch(/generation:\s*initialGeneration\(\)/);
  });

  it('starts the overall status at pending', () => {
    expect(initMatch[1]).toMatch(/status:\s*'pending'/);
  });

  it('seeds all three contract stages (report, notice, sbom) at pending', () => {
    const body = initMatch[1];
    expect(body).toMatch(/report:\s*'pending'/);
    expect(body).toMatch(/notice:\s*'pending'/);
    expect(body).toMatch(/sbom:\s*'pending'/);
  });

  it('seeds current=null, startedAt set, finishedAt=null, error=null', () => {
    const body = initMatch[1];
    expect(body).toMatch(/current:\s*null/);
    expect(body).toMatch(/startedAt:\s*new Date\(\)/);
    expect(body).toMatch(/finishedAt:\s*null/);
    expect(body).toMatch(/error:\s*null/);
  });

  it('declares the stages in contract order report → notice → sbom', () => {
    const body = initMatch[1];
    const r = body.indexOf('report');
    const n = body.indexOf('notice');
    const b = body.indexOf('sbom');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(n).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(n);
  });
});

describe('#79 create.js - background vs synchronous are two distinct branches', () => {
  // The fast-return AC: the wizard/createFromDraft path must take a branch that
  // launches phase-2 fire-and-forget; REST takes the awaited branch. Prove both
  // branches exist and are selected by `if (background)`.
  it('selects the mode on an `if (background)` guard', () => {
    expect(createCode).toMatch(/if\s*\(\s*background\s*\)/);
  });

  it('background branch launches runApproveGeneration WITHOUT await and attaches .catch', () => {
    // Find the if(background) block up to its matching else.
    const branchMatch = createCode.match(/if\s*\(\s*background\s*\)\s*\{([\s\S]*?)\}\s*else\s*\{/);
    expect(branchMatch).not.toBeNull();
    const bg = branchMatch[1];
    // fire-and-forget: invoked + .catch, never awaited inside this branch.
    expect(bg).toMatch(/runApproveGeneration\([^;]*\)\s*\.catch\s*\(/s);
    expect(bg).not.toMatch(/await\s+runApproveGeneration/);
  });

  it('synchronous (else) branch AWAITS runApproveGeneration (REST stays complete)', () => {
    // Anchor on the if(background)…else of the phase-2 dispatch (its else block
    // contains the awaited synchronous launch) - not any other else block.
    const dispatchMatch = createCode.match(
      /if\s*\(\s*background\s*\)\s*\{[\s\S]*?\}\s*else\s*\{([\s\S]*?await\s+runApproveGeneration\([\s\S]*?)\n\s*\}/
    );
    expect(dispatchMatch).not.toBeNull();
    expect(dispatchMatch[1]).toMatch(/await\s+runApproveGeneration\(/);
  });

  it('returns approveId at the function tail regardless of branch', () => {
    // The fast return only matters if approveId is returned outside/after the
    // branch - not gated behind awaiting phase-2.
    expect(createCode).toMatch(/return\s+approveId\b/);
    const returnIdx = createCode.lastIndexOf('return approveId');
    const bgInvokeIdx = createCode.search(/runApproveGeneration\([^;]*\)\s*\.catch/s);
    expect(bgInvokeIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(bgInvokeIdx);
  });
});

describe('#79 create.js - background .catch writes a terminal failed state', () => {
  // A fire-and-forget rejection must never be silently dropped; the .catch must
  // record a terminal failed generation so the progress UI does not hang.
  const catchMatch = createCode.match(/\.catch\s*\(\s*async\s*\(\s*err\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;/);

  it('the background .catch persists generation.status failed', () => {
    expect(catchMatch).not.toBeNull();
    expect(catchMatch[1]).toMatch(/'generation\.status'\s*:\s*'failed'/);
  });

  it('the background .catch clears current and stamps finishedAt + a GENERIC error', () => {
    // Security hardening (Finding-1): `generation.error` is a user-facing field,
    // so it now persists a GENERIC message (GENERIC_GENERATION_ERROR) - raw
    // S3/Mongo/library detail is server-log-only via console.log(safeMessage(...)).
    // Asserting the generic constant (and the absence of safeMessage feeding the
    // banner) locks in that no internal error string can leak to the user.
    const body = catchMatch[1];
    expect(body).toMatch(/'generation\.current'\s*:\s*null/);
    expect(body).toMatch(/'generation\.finishedAt'/);
    expect(body).toMatch(/'generation\.error'\s*:\s*GENERIC_GENERATION_ERROR\b/);
    expect(body).not.toMatch(/'generation\.error'\s*:\s*safeMessage\(/);
  });
});

describe('#79 create.js - safeMessage trims errors to a bounded, safe string', () => {
  const safeMatch = createCode.match(/function safeMessage\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);

  it('defines a safeMessage helper', () => {
    expect(safeMatch).not.toBeNull();
  });

  it('prefers e.reason / e.message and falls back to String(e) (never the raw object)', () => {
    const body = safeMatch[1];
    expect(body).toMatch(/\.reason/);
    expect(body).toMatch(/\.message/);
    expect(body).toMatch(/String\(/);
  });

  it('caps the persisted message length (no unbounded error spill)', () => {
    expect(safeMatch[1]).toMatch(/\.slice\(\s*0\s*,\s*\d+\s*\)/);
  });
});

describe('#79 create.js - generation.error is GENERIC; raw detail is server-log-only (Finding-1)', () => {
  // Security hardening: the user-facing `generation.error` banner must carry only
  // a generic message. Raw S3/Mongo/library error strings stay on the server
  // console via safeMessage(). These assertions lock that boundary in.
  it('defines generic, user-facing failure constants', () => {
    expect(createCode).toMatch(/const\s+GENERIC_GENERATION_ERROR\s*=/);
    expect(createCode).toMatch(/const\s+GENERIC_STAGE_ERROR\s*=/);
  });

  it('the terminal failed write persists a GENERIC message (per-stage or fallback)', () => {
    expect(createCode).toMatch(
      /'generation\.error'\s*:\s*GENERIC_STAGE_ERROR\[[^\]]*\]\s*\|\|\s*GENERIC_GENERATION_ERROR/
    );
  });

  it('NEVER assigns safeMessage(...) into generation.error anywhere (no raw leak to banner)', () => {
    expect(createCode).not.toMatch(/'generation\.error'\s*:\s*safeMessage\(/);
  });

  it('still routes raw detail to the server console via safeMessage in console.log', () => {
    // safeMessage is retained, but only for server-side logging - never the banner.
    expect(createCode).toMatch(/console\.log\([^)]*safeMessage\(/);
  });
});

describe('#79 rest-api/approves.js - REST omits background (stays synchronous)', () => {
  // The REST POST path must NOT pass background:true, so Approves.Create takes the
  // awaited synchronous branch and returns a fully-generated approve. Isolate the
  // `approve` payload object built before the Approves.Create call.
  it('builds an approve payload and calls Approves.Create with it', () => {
    expect(restCode).toMatch(/const approve\s*=\s*\{/);
    expect(restCode).toMatch(/Meteor\.callAsync\(\s*'Approves\.Create'\s*,\s*approve\s*\)/);
  });

  it('does NOT set a background flag anywhere in the REST endpoint', () => {
    // No `background: true` / `background = true` in the REST file - the absence
    // is what keeps REST synchronous per the binding USER DECISION.
    expect(restCode).not.toMatch(/background\s*[:=]\s*true/);
    expect(restCode).not.toMatch(/\bbackground\b/);
  });

  it('passes apiUser (api key user) so detached scope is preserved on the sync path', () => {
    expect(restCode).toMatch(/apiUser:\s*keyMetaAndCompany\.user/);
  });
});
