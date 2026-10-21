import {Meteor} from 'meteor/meteor';
import RiskProperties from '/imports/lib/collections/riskProperties';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import Tests from '/imports/lib/collections/tests';
import {userDisplayName} from '/imports/lib/user/displayName';
import {planCweRisks, describeDropped, desiredPrevCount, isSourceRefsUnchanged, toolLabel,
  SARIF_RECONCILE_MAX_TESTS, CWE_RISK_MAX_TOOLS,
  CWE_RISKS_MAX_PER_IMPORT} from '/imports/lib/sarif/cweRiskPlan';
import {UNTOUCHED_RISK_STATES} from './managedFields';

// Keep the risk register in step with the weaknesses a SARIF import published.
//
// Called from BOTH import paths - the REST endpoint (which passes the API key's
// company and user) and, over DDP, the Blaze upload modal (which passes neither
// and gets both derived from the session). The DDP signature is deliberately
// (moduleId, testIds) and nothing else: every other input is re-read from the
// database server-side, so there is nothing a client could name that it does not
// already own.
//
// SERVER-ONLY BY CONTRACT. Never import from imports/client/**.

// Module and test ids go straight into a Mongo selector. Meteor's own _id is 17
// characters; the bound is generous and exists so a caller cannot make the
// selector arbitrarily large.
const ID_MAX = 64;
// One import's stale sweep touches at most this many risks. A module with more
// auto-managed risks than this for one tool is not a case worth spending an
// unbounded query on inside a synchronous REST response.
//
// STALE_SWEEP_SORT is what makes WHICH 500 deterministic. Without a sort the
// limit hands back whatever order the storage engine happened to walk, so a
// module over the limit would sweep a different subset on every import and the
// same document imported twice would produce different writes.
const STALE_SWEEP_LIMIT = 500;
const STALE_SWEEP_SORT = {'riskProperties.autoKey': 1};

const PROJECTION = {fields: {
  _id: 1,
  name: 1,
  'riskProperties.state': 1,
  // Read back for the stale sweep's log message, which has to name the weakness
  // whose evidence it just cleared (AC28).
  'riskProperties.autoCwe': 1,
  'riskProperties.sourceRefs': 1,
  'riskProperties.sourceRefsTotal': 1,
  'riskProperties.sourceRefsTruncated': 1,
  'riskProperties.sourceRefsPrevCount': 1
}};

// The same three-line predicate cweMappings/set.js uses.
function isDuplicateKey(error) {
  return !!error && (error.code === 11000 || /E11000/.test(error.message || ''));
}

function emptyResult(reason) {
  return {enabled: false, reason, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0};
}

function isUsableId(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

// Step 0 - bounds BEFORE any work proportional to the input.
//
// Schema validation only runs at insert, which is far too late to protect a
// single-threaded server from a caller-supplied array; cweMappings/set.js
// establishes this order for the same reason. Non-string entries are refused
// rather than coerced - these go into a Mongo selector.
function assertArguments(moduleId, testIds) {
  if (!isUsableId(moduleId, ID_MAX)) {
    throw new Meteor.Error(400, 'Invalid arguments');
  }
  if (!Array.isArray(testIds) || testIds.length > SARIF_RECONCILE_MAX_TESTS) {
    throw new Meteor.Error(400, 'Invalid arguments');
  }
  for (const testId of testIds) {
    if (!isUsableId(testId, ID_MAX)) {
      throw new Meteor.Error(400, 'Invalid arguments');
    }
  }
}

// Step 1 - the gate chain, in order. Every failure past the module check is a
// SILENT no-op: an ungated import stores its tests, updates the module quality
// and answers 201 exactly as it does today, with zero riskProperties and zero
// logevents written.
async function resolveContext(moduleId, companyId, trusted) {
  const module = await Modules.findOneAsync({_id: moduleId, companyId},
    {fields: {projectId: 1}});
  if (!module) {
    // A DDP caller naming a module outside their own company gets a 403 (AC29).
    // The REST path already resolved the module inside the caller's company, so
    // a miss there is a race, not an attack - it must not turn a stored document
    // into an error.
    if (trusted) {
      return {result: emptyResult('no-module')};
    }
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (!module.projectId) {
    return {result: emptyResult('no-project')};                          // AC5
  }
  const project = await Projects.findOneAsync({_id: module.projectId, companyId},
    {fields: {autoCreateCweRisks: 1}});
  // Strict `=== true`: the field is optional with no defaultValue, so "off" is
  // usually "absent", and nothing truthy-but-not-true may switch a customer's
  // risk register on (AC1).
  if (!project || project.autoCreateCweRisks !== true) {
    return {result: emptyResult('toggle-off')};
  }
  return {projectId: module.projectId};
}

// Step 2 - re-read the runs. NEVER trust the caller's content: only ids are
// accepted, and a document that does not resolve inside the caller's own company
// and module is silently dropped. That is what makes the DDP-retry (AC21) and
// the concurrent-import (AC18) cases safe.
async function readDocuments(testIds, companyId, moduleId) {
  const docs = await Tests.find(
    {_id: {$in: testIds}, companyId, moduleId, type: 'SARIF'},
    {fields: {data: 1, tool: 1}}).fetchAsync();
  const documents = [];
  docs.forEach(function (doc) {
    let run;
    try {
      run = doc.data ? JSON.parse(doc.data) : null;
    } catch (error) {
      // One unparseable stored run must not abandon the rest of the import. The
      // reason is logged server-side and never returned - same treatment the
      // SARIF detail endpoint already gives a stored run it cannot parse.
      console.error('reconcileFromSarif: stored run is not parseable JSON for test ' + doc._id,
        error.toString());
      return;
    }
    if (run) {
      documents.push({tool: doc.tool, run});
    }
  });
  return documents;
}

// The UPDATE branch, shared by the reconcile and the stale sweep.
//
// `name`, `origin`, `threatModelContext.cwes`, `userId`, `userName` and above
// all `state` are NEVER written after creation. That is what makes AC19 hold
// (editing an auto risk and re-importing updates that same risk rather than
// creating a second) and what keeps a human's rename and state decision intact
// (AC23, AC27).
async function applyUpdate(existing, next, context) {
  const props = existing.riskProperties || {};
  if (UNTOUCHED_RISK_STATES.indexOf(props.state) !== -1) {
    // AC26: not written to AT ALL - and note the identity lookup happened
    // anyway, so no second risk is created for this key either.
    return 'skipped';
  }
  const storedRefs = Array.isArray(props.sourceRefs) ? props.sourceRefs : [];
  const storedTotal = typeof props.sourceRefsTotal === 'number' ?
    props.sourceRefsTotal : storedRefs.length;
  const storedTrunc = !!props.sourceRefsTruncated;
  const storedPrev = typeof props.sourceRefsPrevCount === 'number' ?
    props.sourceRefsPrevCount : undefined;
  const nextPrev = desiredPrevCount(storedTotal, storedPrev, next.sourceRefs.length);

  if (isSourceRefsUnchanged(
    {sourceRefs: storedRefs, sourceRefsTotal: storedTotal,
      sourceRefsTruncated: storedTrunc, sourceRefsPrevCount: storedPrev},
    {sourceRefs: next.sourceRefs, sourceRefsTotal: next.sourceRefsTotal,
      sourceRefsTruncated: next.sourceRefsTruncated, sourceRefsPrevCount: nextPrev})) {
    // AC15, the user's number-one requirement in its sharp form: no
    // updateAsync, so no `edited`, and no logEvent.
    return 'unchanged';
  }

  const modifier = {$set: {
    'riskProperties.sourceRefs': next.sourceRefs,
    'riskProperties.sourceRefsTotal': next.sourceRefsTotal,
    'riskProperties.sourceRefsTruncated': next.sourceRefsTruncated,
    edited: new Date()
  }};
  if (nextPrev === undefined) {
    modifier.$unset = {'riskProperties.sourceRefsPrevCount': ''};
  } else {
    modifier.$set['riskProperties.sourceRefsPrevCount'] = nextPrev;
  }
  await RiskProperties.updateAsync({_id: existing._id, companyId: context.companyId}, modifier);
  // toolLabel, not the raw segment: the driver name is uploaded content and
  // Company Logs is exported to CSV with `quotes: false`, so a name carrying a
  // comma, a newline or a leading `=` would forge a row or a spreadsheet
  // formula. It is the same filter the risk NAME goes through, in one place.
  await Meteor.callAsync('logEvent', context.actor,
    'Risk source references for ' + next.cwe + ' (' + toolLabel(next.tool) + ') updated: ' +
    storedTotal + ' -> ' + next.sourceRefsTotal + ' occurrences', 'cweRiskSourceRefsUpdated');
  return 'updated';
}

async function insertRisk(risk, tool, context) {
  await RiskProperties.insertAsync({
    created: new Date(),
    userId: context.actor._id,
    userName: userDisplayName(context.actor),
    companyId: context.companyId,
    projectId: context.projectId,
    moduleId: context.moduleId,
    name: risk.name,
    riskProperties: {
      state: 'identified',
      origin: ['CWE'],
      autoKey: risk.autoKey,
      autoTool: tool,
      autoCwe: risk.cwe,
      sourceRefs: risk.sourceRefs,
      sourceRefsTotal: risk.sourceRefsTotal,
      sourceRefsTruncated: risk.sourceRefsTruncated,
      threatModelContext: {cwes: [risk.cwe]}
    }
  });
  // The name already reads "[CWE-79] Weakness reported by Semgrep", so naming
  // the weakness and the tool a second time in the same sentence says nothing
  // the reader has not just read. Same shape as the update message above.
  await Meteor.callAsync('logEvent', context.actor,
    'Risk ' + risk.name + ' created (' + risk.sourceRefsTotal + ' occurrences)',
    'cweRiskCreated');
}

// One (tool, CWE): create it, or bring its evidence up to date, or leave it
// completely alone.
async function upsertRisk(risk, tool, context) {
  const selector = {companyId: context.companyId, 'riskProperties.autoKey': risk.autoKey};
  let existing = await RiskProperties.findOneAsync(selector, PROJECTION);
  if (!existing) {
    try {
      await insertRisk(risk, tool, context);
      return 'created';
    } catch (error) {
      // Meteor re-sends an outstanding method call on reconnect and
      // two CI jobs can POST the same document at once (AC18). The unique
      // partial index turns the loser into a duplicate-key error rather than a
      // duplicate row; treat it as the update it really is, so neither request
      // fails.
      if (!isDuplicateKey(error)) {
        throw error;
      }
      existing = await RiskProperties.findOneAsync(selector, PROJECTION);
      if (!existing) {
        return 'skipped';
      }
      // ...and fall through to the update branch WITHOUT logging a create.
    }
  }
  return applyUpdate(existing, Object.assign({tool}, risk), context);
}

// Step 5 - the stale sweep. A weakness the newest document for this tool no
// longer reports keeps its risk, its state and its _id, and simply loses its
// evidence (AC24). `autoTool` exists precisely so this selector needs no prefix
// parsing and rides the existing moduleId index.
//
// A tool absent from THIS import is never swept (AC17), and an already-empty
// stale risk goes through the same unchanged check, so it costs no write and no
// log entry.
async function sweepStale(tool, keys, context, counters) {
  const stale = await RiskProperties.find({
    companyId: context.companyId,
    moduleId: context.moduleId,
    'riskProperties.autoTool': tool,
    'riskProperties.autoKey': {$nin: keys}
  }, Object.assign({limit: STALE_SWEEP_LIMIT, sort: STALE_SWEEP_SORT}, PROJECTION)).fetchAsync();

  for (const existing of stale) {
    try {
      const outcome = await applyUpdate(existing, {
        tool,
        cwe: (existing.riskProperties && existing.riskProperties.autoCwe) || 'the weakness',
        sourceRefs: [],
        sourceRefsTotal: 0,
        sourceRefsTruncated: false
      }, context);
      counters[outcome] += 1;
    } catch (error) {
      counters.failed += 1;
      console.error('reconcileFromSarif: stale sweep failed for risk ' + existing._id + ' -',
        (error && error.message) || error);
    }
  }
}

const reconcileFromSarif = async function (options) {
  const params = options || {};
  const moduleId = params.moduleId;
  const testIds = params.testIds;
  assertArguments(moduleId, testIds);

  // companyId/actor are supplied ONLY by trusted server callers (the REST route
  // passes the API key's company and user). A DDP client passes neither: the
  // method signature accepts no third argument, so nothing a browser sends can
  // reach either of these.
  const trusted = !!(params.companyId && params.actor);
  let companyId = params.companyId;
  let actor = params.actor;
  if (!trusted) {
    actor = await Meteor.userAsync();
    companyId = actor && actor.profile && actor.profile.companyId;
    if (!actor || typeof companyId !== 'string' || !companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
  }

  const context = await resolveContext(moduleId, companyId, trusted);
  if (context.result) {
    return context.result;
  }
  if (!testIds.length) {
    return {enabled: true, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0};
  }

  const documents = await readDocuments(testIds, companyId, moduleId);
  const counters = {created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0};
  if (!documents.length) {
    return Object.assign({enabled: true}, counters);
  }

  const writeContext = {companyId, actor, moduleId, projectId: context.projectId};
  const plan = planCweRisks({moduleId, documents});
  // The loop below is the only thing between a 5 MB upload and response.end that
  // grows with the document, so its bound is enforced HERE as well as inside the
  // planner - two writes per risk (the insert and its logEvent) times however
  // many risks the planner returned. planCweRisks already caps both the tool
  // count and the total, so neither guard fires on any document a tool could
  // legitimately produce; they exist so that a later change to the planner
  // cannot quietly make this request unbounded.
  const planned = plan.tools.reduce(function (total, bucket) {
    return total + bucket.risks.length;
  }, 0);
  if (planned > CWE_RISKS_MAX_PER_IMPORT || plan.tools.length > CWE_RISK_MAX_TOOLS) {
    console.error('reconcileFromSarif: plan for module ' + moduleId + ' exceeds its bounds (' +
      plan.tools.length + ' tools, ' + planned + ' risks) - capping at ' +
      CWE_RISK_MAX_TOOLS + '/' + CWE_RISKS_MAX_PER_IMPORT);
  }
  // The caps are not silent: the caller shows this to the user and it is logged.
  const limitMessage = describeDropped(plan.dropped);
  if (limitMessage) {
    console.warn('reconcileFromSarif: module ' + moduleId + ' - ' + limitMessage);
  }
  let budget = CWE_RISKS_MAX_PER_IMPORT;
  for (const bucket of plan.tools.slice(0, CWE_RISK_MAX_TOOLS)) {
    for (const risk of bucket.risks) {
      if (budget <= 0) {
        break;
      }
      budget -= 1;
      try {
        counters[await upsertRisk(risk, bucket.tool, writeContext)] += 1;
      } catch (error) {
        // One weakness failing validation must not abandon the other four - the
        // same per-item isolation testImports/create.js applies per run. The
        // reason is logged and never returned: it can quote a rule id or a tool
        // name out of the uploaded document.
        counters.failed += 1;
        console.error('reconcileFromSarif: ' + risk.cwe + ' (' + bucket.tool +
          ') could not be reconciled for module ' + moduleId + ' -',
        (error && error.message) || error);
      }
    }
    await sweepStale(bucket.tool, bucket.keys, writeContext, counters);
  }
  return Object.assign({enabled: true}, counters, limitMessage ? {limitMessage} : {});
};

export default reconcileFromSarif;
