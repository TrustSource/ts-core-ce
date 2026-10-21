import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Approves from '/imports/lib/collections/approves';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import ApprovesUpdate from './update';
import ApprovesGenerateReports from './generateReports';

// Initial `generation` shape stamped on the doc at insert time (phase-1).
// The frontend renders this reactively via the existing approveDetail publication
// (no new method / publication). Stage order: report → notice → sbom.
function initialGeneration() {
  return {
    status: 'pending',
    stages: {
      report: 'pending',
      notice: 'pending',
      sbom: 'pending'
    },
    current: null,
    startedAt: new Date(),
    finishedAt: null,
    error: null
  };
}

// Trim a thrown value to a safe, short string for the SERVER LOG only (never
// persist a raw error object). Raw storage/Mongo/library detail (file paths, driver
// internals, paths) stays in the console log for debugging and is NOT surfaced
// in the user-facing `generation.error` banner - see GENERIC_STAGE_ERROR below.
function safeMessage(e) {
  const msg = (e && (e.reason || e.message)) || String(e);
  return String(msg).slice(0, 500);
}

// Generic, user-facing failure messages persisted to `generation.error` so the
// progress banner (same-tenant compliance managers) is informative without
// leaking internal error strings. Keyed by stage; GENERIC_GENERATION_ERROR is
// the fallback for the fatal/unknown case.
const GENERIC_STAGE_ERROR = {
  report: 'Compliance report generation failed',
  notice: 'Notice report generation failed',
  sbom: 'SBOM generation failed'
};
const GENERIC_GENERATION_ERROR = 'Report generation failed';

// Write a single `generation.*` patch through the standard interactor so the
// modifier is sanitized and the company scope is enforced. `user` is the
// captured phase-1 user (Meteor.userAsync() is null in the detached chain).
async function patchGeneration(approveId, set, user) {
  return ApprovesUpdate({$set: set}, approveId, false, user);
}

// Phase-2: the 3-stage generation chain. Each stage moves
// generation.current + status to 'running' before and 'done' after; a stage
// that throws is recorded as 'failed' (with a terminal failed generation status)
// but does NOT abort the remaining stages. Captured `user`/`apiUser` are threaded
// explicitly into every sub-call so background writes carry the right companyId.
const runApproveGeneration = async function (doc, approveId, user, apiUser) {
  const timings = [];
  const startTotal = Date.now();
  let failed = false;
  let firstError = null;
  let firstFailedStage = null;

  const {projectId, binaryLinks, demo} = doc;

  // CRITICAL - detached context. By the time this runs (especially the
  // fire-and-forget background launch) Meteor.userAsync() is null, so every
  // sub-call falls back to its `apiUser` arg. The browser wizard never supplies
  // an `apiUser` (it relied on Meteor.userAsync()), so we use the captured
  // phase-1 `user` as the effective api-user. For the REST path apiUser is
  // already === user, so behaviour is unchanged. This keeps the correct
  // companyId / tenant scope on every background write.
  const effectiveApiUser = apiUser || user;

  // Mark the chain as running on the first stage.
  await patchGeneration(approveId, {'generation.status': 'running'}, user);

  // report (= ApprovesGenerateReports: 9 getProject* calls + stats write).
  // ApprovesGenerateReports owns its own running/done stage writes; this layer
  // only records the terminal 'failed' state if the whole stage throws.
  const tReport = Date.now();
  try {
    await ApprovesGenerateReports(doc, approveId, user);
  } catch (e) {
    console.log('approve generation report stage error:', safeMessage(e));
    failed = true;
    if (!firstError) { firstError = e; firstFailedStage = 'report'; }
    await patchGeneration(approveId, {'generation.stages.report': 'failed'}, user);
  }
  timings.push({stage: 'report', ms: Date.now() - tReport});

  // notice
  const tNotice = Date.now();
  try {
    await patchGeneration(approveId, {
      'generation.current': 'notice',
      'generation.stages.notice': 'running'
    }, user);
    const noticeData = await Meteor.callAsync('NoticeFiles.Create', {projectId, approveId, apiUser: effectiveApiUser, binaryLinks, demo});
    if (noticeData) {
      await ApprovesUpdate({$set: {noticeFileId: noticeData}}, approveId, false, effectiveApiUser);
    }
    await patchGeneration(approveId, {'generation.stages.notice': 'done'}, user);
  } catch (e) {
    console.log('NoticeFiles.Create error:', safeMessage(e));
    failed = true;
    if (!firstError) { firstError = e; firstFailedStage = 'notice'; }
    await patchGeneration(approveId, {'generation.stages.notice': 'failed'}, user);
  }
  timings.push({stage: 'notice', ms: Date.now() - tNotice});

  // sbom
  const tSbom = Date.now();
  try {
    await patchGeneration(approveId, {
      'generation.current': 'sbom',
      'generation.stages.sbom': 'running'
    }, user);
    const sbomData = await Meteor.callAsync('SbomFiles.Create', {projectId, approveId, apiUser: effectiveApiUser, demo});
    if (sbomData) {
      await ApprovesUpdate({$set: {sbomFileId: sbomData}}, approveId, false, effectiveApiUser);
    }
    await patchGeneration(approveId, {'generation.stages.sbom': 'done'}, user);
  } catch (e) {
    console.log('SbomFiles.Create error:', safeMessage(e));
    failed = true;
    if (!firstError) { firstError = e; firstFailedStage = 'sbom'; }
    await patchGeneration(approveId, {'generation.stages.sbom': 'failed'}, user);
  }
  timings.push({stage: 'sbom', ms: Date.now() - tSbom});

  // Terminal generation state: failed if any stage threw (preserve the failure
  // instead of the old silent console.log swallow), otherwise done. Persist only
  // a GENERIC per-stage message in `generation.error` (the raw detail was already
  // logged per-stage above); never surface internal error strings to the banner.
  const finishedAt = new Date();
  if (failed) {
    console.log('approve generation failed; first failure:', firstFailedStage, safeMessage(firstError));
    await patchGeneration(approveId, {
      'generation.status': 'failed',
      'generation.current': null,
      'generation.finishedAt': finishedAt,
      'generation.error': GENERIC_STAGE_ERROR[firstFailedStage] || GENERIC_GENERATION_ERROR
    }, user);
  } else {
    await patchGeneration(approveId, {
      'generation.status': 'done',
      'generation.current': null,
      'generation.finishedAt': finishedAt
    }, user);
  }

  // Timing deliverable: one concise, guarded log line per approve generation.
  try {
    const byStage = {};
    timings.forEach((t) => { byStage[t.stage] = t.ms; });
    console.log(
      `[approve-gen ${approveId}] report=${byStage.report}ms ` +
      `notice=${byStage.notice}ms sbom=${byStage.sbom}ms total=${Date.now() - startTotal}ms`
    );
  } catch (e) {
    // The timing log must never throw past this boundary.
    console.log('approve generation timing log error:', e);
  }
};

// Who may start an approval: the roles of the Approvals menu and of the REST
// endpoint's key scope. A request notifies exactly these roles.
export const APPROVAL_CREATE_ROLES = ['manager', 'compliance_manager'];

const create = async function ({name, version, description, projectId, moduleId, modules, draft, purl, apiUser, demo, background}) {
  let user = await Meteor.userAsync();
  if (user) {
    const callerCompanyId = user.profile && user.profile.companyId;
    if (!callerCompanyId || !await Roles.userIsInRoleAsync(user._id, APPROVAL_CREATE_ROLES, callerCompanyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
  } else {
    // REST path: the API key's scope was checked by the endpoint.
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }
  const companyId = user.profile.companyId;
  let binaryLinks = [];
  if(modules.length){
    for (const module of modules) {
      for (const link of (module.binaryLinks || [])) {
        binaryLinks.push(link);
      }
    }
  }
  // Validate client-supplied ids and scope every lookup to the caller's company.
  // Previously projectId/moduleId were resolved by raw id with no company scope -
  // a cross-tenant reference that leaked another tenant's relatedUsers
  // (defaultComplianceManager) into this approve's assignment. NOTE: do not branch
  // on `this`/`this.connection` here - createFromDraft calls this as a plain
  // function (this === undefined); it pre-scopes its draft to {_id, companyId}.
  if (projectId != null && (typeof projectId !== 'string' || !projectId)) {
    throw new Meteor.Error(400, 'Invalid id');
  }
  if (moduleId != null && (typeof moduleId !== 'string' || !moduleId)) {
    throw new Meteor.Error(400, 'Invalid id');
  }
  let project = projectId ? await Projects.findOneAsync({_id: projectId, companyId}, {fields: {relatedUsers: 1}}) : null
  let module = moduleId ? await Modules.findOneAsync({_id: moduleId, companyId}, {fields: {relatedUsers: 1}}) : null
  // A supplied id that does not resolve within the caller's company is a
  // cross-tenant reference - deny rather than fall back to another tenant's doc.
  if (projectId && !project) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (moduleId && !module) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let relatedUser = module ? module.relatedUsers && module.relatedUsers.defaultComplianceManager :
    project && project.relatedUsers && project.relatedUsers.defaultComplianceManager
  let assignment = draft ? user : relatedUser
  const assignmentData = await Meteor.users.findOneAsync(assignment);

  let doc = {
    created: new Date(),
    companyId: companyId,
    projectId,
    moduleId,
    initiator: user._id,
    initiatorName: Utils.username(user),
    assignment: assignmentData && assignmentData._id,
    assignmentName: assignmentData && Utils.username(assignmentData, true),
    name,
    version,
    description,
    modules,
    draft,
    purl,
    binaryLinks,
    demo,
    // Phase-1 stamps the initial generation progress so it is present the
    // moment the doc is inserted (frontend renders it reactively).
    generation: initialGeneration()
  };

  // ---- Phase-1 (always synchronous): fast insert + return approveId ----
  let approveId = await Approves.insertAsync(doc);
  if(approveId){
    await Meteor.callAsync('logEvent', user, 'Initiated ' + name, 'approveCreate');
    if(!draft){
      await Meteor.callAsync('notifyAboutInitApproval', user, projectId, doc, approveId);
    }

    // ---- Phase-2 (generation chain) ----
    if (background) {
      // Wizard / create-from-draft: fire-and-forget so the spinner releases
      // immediately. The .catch guarantees no unhandled rejection ever reaches
      // the event loop and records a terminal failed generation state.
      runApproveGeneration(doc, approveId, user, apiUser).catch(async (err) => {
        // Raw detail to the server log only; persist a generic banner message.
        console.log('runApproveGeneration fatal error:', safeMessage(err));
        try {
          await patchGeneration(approveId, {
            'generation.status': 'failed',
            'generation.current': null,
            'generation.finishedAt': new Date(),
            'generation.error': GENERIC_GENERATION_ERROR
          }, user);
          await Meteor.callAsync('logEvent', user, 'Approve generation failed: ' + name, 'approveCreate');
        } catch (writeErr) {
          // Best-effort terminal write; never let this re-reject.
          console.log('approve generation terminal failed-write error:', writeErr);
        }
      });
    } else {
      // REST / back-compat: block until full generation so the returned approve
      // is COMPLETE (USER DECISION - REST stays synchronous).
      await runApproveGeneration(doc, approveId, user, apiUser);
    }
  }
  return approveId
};

export {runApproveGeneration};
export default create;
