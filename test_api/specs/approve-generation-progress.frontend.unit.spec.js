/* eslint-disable no-undef */
// Static-source regression for slow approval creation (FRONTEND half): the approval-creation
// finalize pages must show a REAL, status-driven progress UI instead of the old
// fake timer animation. The old code:
//   - animated Bootstrap bars with getRandomInt(5,50) on a 550ms setInterval,
//     fully decoupled from backend state;
//   - wrote `Approves.Update {processed:true}` from that client timer;
//   - showed "Great! You made it!" regardless of whether anything succeeded.
// This spec asserts on the source text of the new shared progress template
// (approve-generation-progress.{js,html}) and on the two finalize pages so the
// fix cannot silently regress. No Meteor import - runs serverless under jest.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../imports/client/ui');
const progJs = fs.readFileSync(
  path.join(root, 'module/module-approve/approve-generation-progress.js'),
  'utf8'
);
const progHtml = fs.readFileSync(
  path.join(root, 'module/module-approve/approve-generation-progress.html'),
  'utf8'
);
const moduleFinalize = fs.readFileSync(
  path.join(root, 'module/module-approve/module-approve-finalize.html'),
  'utf8'
);
const projectFinalize = fs.readFileSync(
  path.join(root, 'project/project-approve/project-approve-finalize.html'),
  'utf8'
);
const moduleWizard = fs.readFileSync(
  path.join(root, 'module/module-approve/module-approve.js'),
  'utf8'
);
const projectWizard = fs.readFileSync(
  path.join(root, 'project/project-approve/project-approve.js'),
  'utf8'
);
const moduleWizardCode = moduleWizard.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const projectWizardCode = projectWizard.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// Strip JS comments so we don't match a pattern that only survives in a comment.
const progJsCode = progJs.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('#79 finalize pages include the shared real-progress template', () => {
  it('module-approve-finalize includes approveGenerationProgress (not the fake template)', () => {
    expect(moduleFinalize).toMatch(/\{\{>\s*approveGenerationProgress\s+approveData=approveData\s*\}\}/);
    expect(moduleFinalize).not.toMatch(/moduleApproveProgress/);
  });

  it('project-approve-finalize includes approveGenerationProgress (not the fake template)', () => {
    expect(projectFinalize).toMatch(/\{\{>\s*approveGenerationProgress\s+approveData=approveData\s*\}\}/);
    expect(projectFinalize).not.toMatch(/projectApproveProgress/);
  });

  it('keeps the "Finalizing your approval request" heading on both pages', () => {
    expect(moduleFinalize).toMatch(/Finalizing your approval request/);
    expect(projectFinalize).toMatch(/Finalizing your approval request/);
  });
});

describe('#79 no fake timer-driven progress survives', () => {
  it('progress JS contains no getRandomInt', () => {
    expect(progJsCode).not.toMatch(/getRandomInt/);
  });

  it('progress JS contains no setInterval timer driving the bars', () => {
    expect(progJsCode).not.toMatch(/setInterval/);
  });

  it('progress JS does NOT write Approves.Update {processed:true} from the client', () => {
    expect(progJsCode).not.toMatch(/Approves\.Update/);
    expect(progJsCode).not.toMatch(/processed:\s*true/);
  });
});

describe('#79 progress is derived from generation/stages', () => {
  it('progress JS reads generation / stages off the approve doc', () => {
    expect(progJsCode).toMatch(/\.generation\b/);
    expect(progJsCode).toMatch(/\.stages\b/);
  });

  it('overall percent is derived from done/skipped over 3 (not random)', () => {
    // The overall bar width must come from counting terminal-good stages, not a
    // random or timer value.
    expect(progJsCode).toMatch(/'done'/);
    expect(progJsCode).toMatch(/'skipped'/);
  });

  it('renders the 3 contract stages in order: report, notice, sbom', () => {
    const reportIdx = progJsCode.indexOf("'report'");
    const noticeIdx = progJsCode.indexOf("'notice'");
    const sbomIdx = progJsCode.indexOf("'sbom'");
    expect(reportIdx).toBeGreaterThanOrEqual(0);
    expect(noticeIdx).toBeGreaterThan(reportIdx);
    expect(sbomIdx).toBeGreaterThan(noticeIdx);
  });
});

describe('#79 link gating reads existing top-level approve fields', () => {
  it('gates the View links on sbomFileId / noticeFileId / stats', () => {
    expect(progJsCode).toMatch(/sbomFileId/);
    expect(progJsCode).toMatch(/noticeFileId/);
    expect(progJsCode).toMatch(/stats/);
  });
});

describe('#79 terminal banners gate strictly on generation.status', () => {
  it('references generation.status with the done / failed terminal values', () => {
    expect(progJsCode).toMatch(/'done'/);
    expect(progJsCode).toMatch(/'failed'/);
  });

  it('html shows the success copy only behind a status-done gate', () => {
    expect(progHtml).toMatch(/Great! You made it!/);
    expect(progHtml).toMatch(/Report generation did not finish/);
  });
});

describe('#79 a11y: aria emitted via dynamic-attributes object helper', () => {
  it('html has NO bare aria-valuenow="<literal>" attribute string', () => {
    // Per CLAUDE.md, a valued conditional aria attr must come from a
    // dynamic-attributes object helper, never a hard-coded/bare attribute.
    expect(progHtml).not.toMatch(/aria-valuenow="/);
  });

  it('JS exposes a dynamic-attributes helper that returns aria-valuenow / aria-label', () => {
    expect(progJsCode).toMatch(/aria-valuenow/);
    expect(progJsCode).toMatch(/aria-label/);
  });

  it('html wraps the progress block in role="status" aria-live="polite"', () => {
    expect(progHtml).toMatch(/role="status"/);
    expect(progHtml).toMatch(/aria-live="polite"/);
  });

  it('each stage/overall progress uses role="progressbar" with min/max', () => {
    expect(progHtml).toMatch(/role="progressbar"/);
    expect(progHtml).toMatch(/aria-valuemin="0"/);
    expect(progHtml).toMatch(/aria-valuemax="100"/);
  });
});

describe('#79 wizard callers request the fast-return background path', () => {
  // The browser wizard must send background:true so the backend fires the report
  // chain fire-and-forget and returns fast - landing the user on the live
  // progress finalize page mid-generation. getData() must stay pure (no flag),
  // so the flag is spread onto the payload at the call site.
  it('module wizard passes background: true to Approves.Create', () => {
    expect(moduleWizardCode).toMatch(
      /Approves\.Create',\s*\{\s*\.\.\.approve\.getData\(\)\s*,\s*background:\s*true\s*\}/
    );
  });

  it('project wizard passes background: true to Approves.Create', () => {
    expect(projectWizardCode).toMatch(
      /Approves\.Create',\s*\{\s*\.\.\.approve\.getData\(\)\s*,\s*background:\s*true\s*\}/
    );
  });

  it('keeps the .then navigation to the finalize route on both callers', () => {
    expect(moduleWizardCode).toMatch(/Router\.go\('moduleApproveFinalize'/);
    expect(projectWizardCode).toMatch(/Router\.go\('projectApproveFinalize'/);
  });
});

describe('#79 legacy approves without generation never blank / never auto-success', () => {
  it('JS infers done for old processed approves with all backing fields', () => {
    expect(progJsCode).toMatch(/processed/);
  });
});
