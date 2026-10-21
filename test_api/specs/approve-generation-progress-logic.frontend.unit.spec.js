/* eslint-disable no-undef */
// Static-source regression for slow approval creation (FRONTEND logic gaps) - companion to
// approve-generation-progress.frontend.unit.spec.js.
//
// The sibling spec proves the template is wired to `generation`/`stages`, has no
// fake timer, and gates banners on status. This spec closes the BEHAVIOURAL gaps
// in the progress derivation that it only touched loosely:
//   - legacyDone(): old approves with no `generation` are inferred done ONLY when
//     processed AND sbomFileId + noticeFileId + stats are present;
//   - effectiveStatus(): absent generation maps to legacy-done OR pending - never
//     a perpetual blank / never an unconditional success;
//   - stageState()/skipped: a 'skipped' stage is counted as terminally-accounted
//     (done|skipped) toward the overall percent;
//   - the backend `current` pointer flips a still-pending stage to running.
//
// Source-text assertions (no Meteor render harness available under jest/node), so
// we assert the SHAPE of the derivation functions rather than their output. The
// reason this is a source-text proxy and not a render test is documented in the
// Coverage Gaps section of the automation report.
const fs = require('fs');
const path = require('path');

const progJs = fs.readFileSync(
  path.join(
    __dirname,
    '../../imports/client/ui/module/module-approve/approve-generation-progress.js'
  ),
  'utf8'
);
// Strip comments so a pattern that only survives in a comment cannot pass.
const code = progJs.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('#79 legacyDone() - old approves with no generation', () => {
  const fn = code.match(/function legacyDone\s*\(\)\s*\{([\s\S]*?)\n\}/);

  it('defines a legacyDone() inference helper', () => {
    expect(fn).not.toBeNull();
  });

  it('returns false the moment a modern `generation` object exists', () => {
    // Modern approves carry generation.status and must not fall through to the
    // legacy heuristic.
    expect(fn[1]).toMatch(/if\s*\(\s*a\.generation\s*\)\s*return\s+false/);
  });

  it('requires `processed` before inferring completeness', () => {
    expect(fn[1]).toMatch(/if\s*\(\s*!a\.processed\s*\)\s*return\s+false/);
  });

  it('only infers done when sbomFileId AND noticeFileId AND stats are all backed', () => {
    expect(fn[1]).toMatch(/!!a\.sbomFileId\s*&&\s*!!a\.noticeFileId\s*&&\s*!!a\.stats/);
  });
});

describe('#79 effectiveStatus() - never blank, never auto-success', () => {
  const fn = code.match(/function effectiveStatus\s*\(\)\s*\{([\s\S]*?)\n\}/);

  it('defines an effectiveStatus() helper', () => {
    expect(fn).not.toBeNull();
  });

  it('uses the real generation.status when present', () => {
    expect(fn[1]).toMatch(/if\s*\(\s*g\.status\s*\)\s*return\s+g\.status/);
  });

  it('falls back to done ONLY via legacyDone(), otherwise pending (not blank)', () => {
    expect(fn[1]).toMatch(/if\s*\(\s*legacyDone\(\)\s*\)\s*return\s+'done'/);
    expect(fn[1]).toMatch(/return\s+'pending'/);
  });
});

describe('#79 stageState() - legacy backing inference', () => {
  const fn = code.match(/function stageState\s*\(\s*key\s*\)\s*\{([\s\S]*?)\n\}/);

  it('defines a stageState(key) helper', () => {
    expect(fn).not.toBeNull();
  });

  it('returns the backend stage value verbatim when present', () => {
    expect(fn[1]).toMatch(/const s\s*=\s*stages\(\)\[key\]/);
    expect(fn[1]).toMatch(/if\s*\(\s*s\s*\)\s*return\s+s/);
  });

  it('surfaces every stage as done for a legacy-done approve', () => {
    expect(fn[1]).toMatch(/if\s*\(\s*legacyDone\(\)\s*\)\s*\{\s*return\s+'done'/);
  });

  it('defaults to pending (queued) when nothing is known', () => {
    expect(fn[1]).toMatch(/return\s+'pending'/);
  });
});

describe('#79 doneCount()/overallPercent - skipped counts as terminally done', () => {
  it('doneCount counts both done AND skipped stages', () => {
    const fn = code.match(/function doneCount\s*\(\)\s*\{([\s\S]*?)\n\}/);
    expect(fn).not.toBeNull();
    expect(fn[1]).toMatch(/row\.state\s*===\s*'done'\s*\|\|\s*row\.state\s*===\s*'skipped'/);
  });

  it('overallPercent divides doneCount by the 3-stage total (not a timer/random)', () => {
    expect(code).toMatch(/doneCount\(\)\s*\/\s*STAGE_ORDER\.length/);
    expect(code).toMatch(/STAGE_ORDER\s*=\s*\[\s*'report'\s*,\s*'notice'\s*,\s*'sbom'\s*\]/);
  });
});

describe('#79 stageRows() - backend `current` pointer drives the running row', () => {
  const fn = code.match(/function stageRows\s*\(\)\s*\{([\s\S]*?)\n\}/);

  it('reads generation.current', () => {
    expect(fn).not.toBeNull();
    expect(fn[1]).toMatch(/generation\(\)\.current/);
  });

  it('flips a still-pending stage to running when it is the current stage and status is running', () => {
    expect(fn[1]).toMatch(
      /state\s*===\s*'pending'\s*&&\s*cur\s*===\s*key\s*&&\s*effectiveStatus\(\)\s*===\s*'running'/
    );
    expect(fn[1]).toMatch(/state\s*=\s*'running'/);
  });
});

describe('#79 per-stage skipped representation (icon + bar + a11y)', () => {
  it('skipped maps to a muted "not applicable" status and minus-circle icon', () => {
    // stageStatusText + stageIcon must distinguish skipped from done/failed.
    expect(code).toMatch(/case\s*'skipped'\s*:\s*return\s*'Not applicable'/);
    expect(code).toMatch(/case\s*'skipped'\s*:\s*return\s*'fa fa-minus-circle text-muted'/);
  });

  it('skipped emits an aria-label (not aria-valuenow) for its progress bar', () => {
    // skipped is non-numeric, so it must use the descriptive aria-label branch.
    expect(code).toMatch(/STAGE_SKIPPED_ARIA/);
    expect(code).toMatch(/this\.state\s*===\s*'skipped'/);
  });
});
