/* eslint-disable no-undef */
// Static-source regression for slow approval creation.
//
// Approves.Create was returning the approveId only AFTER sequentially awaiting
// ~12 heavy sub-ops (ApprovesGenerateReports + Notice/Sbom file create).
// The browser wizard blocked on a spinner the whole time. The fix splits
// create.js into a fast phase-1 (validate + scope + insert + init `generation`)
// and a phase-2 generation chain (`runApproveGeneration`) that can run either
// synchronously (REST, default) or fire-and-forget in the background (wizard,
// create-from-draft) gated by an optional `background` payload flag.
//
// This spec asserts the SHAPE of that refactor from source text (no Meteor
// import) so the jest harness runs it serverless, mirroring
// approves-create-scope.unit.spec.js. The live behaviour (REST stays
// synchronous + complete) is covered by approves-generation.spec.js.
const fs = require('fs');
const path = require('path');

function readStripped(rel) {
  const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  // Strip comments so assertions match real code, not documentation.
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const createCode = readStripped('../../imports/lib/interactors/approves/create.js');
const genCode = readStripped('../../imports/lib/interactors/approves/generateReports.js');
const draftCode = readStripped('../../imports/lib/interactors/approves/createFromDraft.js');
const schemaCode = readStripped('../../imports/lib/schemas/approveSchema.js');

describe('#79 create.js - background flag + fast phase-1', () => {
  it('destructures a `background` flag from the payload', () => {
    expect(createCode).toMatch(/\bbackground\b/);
    // it is read off the same destructured args object as the other fields
    expect(createCode).toMatch(/async function\s*\(\s*\{[^}]*\bbackground\b[^}]*\}\s*\)/s);
  });

  it('initialises a `generation` object on the doc before insert', () => {
    // generation must be part of the inserted doc, not bolted on afterwards.
    const docMatch = createCode.match(/let\s+doc\s*=\s*\{[\s\S]*?\};/);
    expect(docMatch).not.toBeNull();
    expect(docMatch[0]).toMatch(/generation/);
    // initial generation status is 'pending' and carries the 3 stage keys
    expect(createCode).toContain("'pending'");
    expect(createCode).toMatch(/report/);
    expect(createCode).toMatch(/notice/);
    expect(createCode).toMatch(/sbom/);
  });

  it('insertAsync runs before the heavy generation chain is INVOKED (fast return)', () => {
    // Look at the invocation order, not the function definition. The phase-2
    // chain is invoked as either `await runApproveGeneration(` (sync branch) or
    // `runApproveGeneration(...).catch(` (bg branch) - both come after insert.
    const insertIdx = createCode.search(/Approves\.insertAsync/);
    const invokeIdx = createCode.search(/(?:await\s+runApproveGeneration\(|runApproveGeneration\([^;]*\)\s*\.catch)/s);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(invokeIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeLessThan(invokeIdx);
  });
});

describe('#79 create.js - two-phase generation (runApproveGeneration)', () => {
  it('defines/extracts a runApproveGeneration phase-2 function', () => {
    expect(createCode).toMatch(/runApproveGeneration/);
  });

  it('the synchronous (default) branch AWAITS the generation chain', () => {
    // REST + back-compat path blocks until full generation.
    expect(createCode).toMatch(/await\s+runApproveGeneration\(/);
  });

  it('the background branch is fire-and-forget with a .catch (no await, no unhandled rejection)', () => {
    // Background launch must attach a .catch so a rejection never reaches the
    // event loop, and must NOT be awaited (otherwise it is not a fast return).
    expect(createCode).toMatch(/runApproveGeneration\([^;]*\)\s*\.catch\s*\(/s);
  });

  it('the chain-level silent `catch { console.log }` swallow is gone', () => {
    // The old code wrapped each sub-op in `try { } catch (e) { console.log(...) }`
    // and lost the failure. A terminal failed generation state must be written
    // instead of merely console.log-swallowed. Assert a failed status is set.
    expect(createCode).toMatch(/'failed'/);
  });

  it('passes the captured user explicitly into the detached generation chain', () => {
    // After phase-1 returns, Meteor.userAsync() is null - the resolved user must
    // be threaded through so background writes carry the correct companyId.
    expect(createCode).toMatch(/runApproveGeneration\([^)]*\buser\b[^)]*\)/s);
  });

  it('emits a single per-stage timing log line (timing deliverable)', () => {
    expect(createCode).toMatch(/approve-gen/);
  });
});

describe('#79 create.js - status-transition contract (stage order + terminal states)', () => {
  it('runs the stages in report → notice → sbom order', () => {
    const noticeIdx = createCode.search(/'generation\.stages\.notice'\s*:\s*'running'/);
    const sbomIdx = createCode.search(/'generation\.stages\.sbom'\s*:\s*'running'/);
    // report is owned by generateReports.js (asserted there); notice<sbom
    // proves the remaining order in create.js.
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(sbomIdx).toBeGreaterThan(noticeIdx);
  });

  it('writes a terminal generation.status of done when no stage failed', () => {
    expect(createCode).toMatch(/'generation\.status'\s*:\s*'done'/);
    expect(createCode).toMatch(/'generation\.finishedAt'/);
    // current is cleared on completion
    expect(createCode).toMatch(/'generation\.current'\s*:\s*null/);
  });

  it('writes a terminal generation.status of failed with a GENERIC user-facing error when a stage threw', () => {
    // Security hardening (Finding-1): generation.error must NOT carry the raw
    // S3/Mongo/library error string (info hygiene + clean UX). It persists a
    // generic per-stage message; the raw detail stays in the server console log.
    expect(createCode).toMatch(/'generation\.status'\s*:\s*'failed'/);
    expect(createCode).toMatch(/'generation\.error'\s*:\s*GENERIC_STAGE_ERROR\[/);
    // safeMessage is retained but only feeds the server console.log, never error.
    expect(createCode).not.toMatch(/'generation\.error'\s*:\s*safeMessage\(/);
  });

  it('threads the captured user as the effective api-user for detached sub-calls', () => {
    // Detached context: the wizard supplies no apiUser, so the captured user
    // must back-fill it to preserve companyId / tenant scope.
    expect(createCode).toMatch(/effectiveApiUser\s*=\s*apiUser\s*\|\|\s*user/);
    expect(createCode).toMatch(/NoticeFiles\.Create[\s\S]*effectiveApiUser/);
  });

  it('preserves the per-stage inner try/catch so one failure does not abort others', () => {
    // Each of report/notice/sbom is wrapped so a throw records a failed stage and
    // continues. Count the per-stage catch blocks that set a failed stage.
    const failedStageWrites = createCode.match(/'generation\.stages\.\w+'\s*:\s*'failed'/g) || [];
    // report + notice + sbom each have a failed-stage write in create.js
    expect(failedStageWrites.length).toBeGreaterThanOrEqual(3);
  });
});

describe('#79 generateReports.js - report stage status writes', () => {
  it('marks the report stage running/done via a generation update', () => {
    expect(genCode).toMatch(/generation\.stages\.report/);
    expect(genCode).toMatch(/'running'/);
    expect(genCode).toMatch(/'done'/);
  });

  it('still writes the stats object (preserves existing behaviour)', () => {
    expect(genCode).toMatch(/stats/);
  });
});

describe('#79 createFromDraft.js - promotes draft in the background', () => {
  it('passes background:true into ApprovesCreate', () => {
    // Accept either the object-literal form (`background: true`) or the property
    // assignment form (`draft.background = true`) used here to match the
    // existing `draft.draft = false` idiom.
    expect(draftCode).toMatch(/background\s*[:=]\s*true/);
  });
});

describe('#79 approveSchema.js - generation field', () => {
  it('adds an optional blackbox `generation` field', () => {
    expect(schemaCode).toMatch(/generation:\s*\{[^}]*blackbox:\s*true[^}]*optional:\s*true[^}]*\}/s);
  });

  it('leaves the legacy `processed` field in place (no migration)', () => {
    expect(schemaCode).toMatch(/processed:/);
  });
});
