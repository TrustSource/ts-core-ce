
import {Meteor} from 'meteor/meteor';
import Tests from '/imports/lib/collections/tests';
import Modules from '/imports/lib/collections/modules';
import Utils from '/imports/lib/utils';
import {resolveResultSeverity, getRunQualityBucket, collectRules} from '/imports/lib/sarif/runStatus';
import {collectRunCwes} from '/imports/lib/sarif/cweExtract';
import {runRefsBelongTo} from './runRefs';

// Rule ids and driver names come straight out of the uploaded SARIF, so both can
// spell a member every plain object already answers to: `constructor`,
// `toString`, `valueOf`, `hasOwnProperty`, `__proto__`. On such a key
// `if (!map[name])` is never true (the initialiser is skipped and the next line
// increments a function into NaN) and `map[name] = value` runs Object.prototype's
// `__proto__` setter instead of storing anything - which is a process-wide,
// cross-tenant write from one authenticated upload.
//
// hasOwnProperty answers the question that was meant, and defineProperty stores
// under any name at all. The maps stay plain objects because they are persisted:
// a null-prototype object has no business crossing the BSON boundary.
function hasOwn (target, key){
  return Object.prototype.hasOwnProperty.call(target, key)
}

function setOwn (target, key, value){
  Object.defineProperty(target, key, {value, writable: true, enumerable: true, configurable: true})
}

function bumpRule (map, ruleId){
  setOwn(map, ruleId, hasOwn(map, ruleId) ? map[ruleId] + 1 : 1)
}

function countRules (level, ruleId, rulesViolations, rulesWarnings, rulesNotes){
  let newRuleId = ruleId.replace(/\./g, '___').replace(/^\$/, '_dollar_')
  if(level === 'error'){
    bumpRule(rulesViolations, newRuleId)
  }else if(level === 'warning'){
    bumpRule(rulesWarnings, newRuleId)
  }else if(level === 'note'){
    bumpRule(rulesNotes, newRuleId)
  }
}

// eslint-disable-next-line sonarjs/cognitive-complexity
const create = async function ({moduleId, analysisId, companyId, scanId, projectName, moduleName, file, type, demo}, callback) {
  const submitted = new Date();
  const user = Meteor.isClient ? Meteor.user() : null;
  const companyIdentifier = user && user.profile && user.profile.companyId ? user.profile.companyId : companyId;
  // Tenant isolation: a caller may only attach tests to (and update the quality
  // of) a module owned by their own company. moduleId can arrive resolved from a
  // raw scanId/analysisId or passed directly, so verify ownership here.
  if (moduleId) {
    const ownedModule = await Modules.findOneAsync(
      {_id: moduleId, companyId: companyIdentifier}, {fields: {_id: 1}});
    if (!ownedModule) {
      throw new Meteor.Error(403, 'Access Denied');
    }
  }
  if (Meteor.isServer && !await runRefsBelongTo({companyId: companyIdentifier, moduleId, analysisId, scanId})) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let tests = []
  let statuses = {}
  if(file.runs && file.runs.length > 0){
    for (const [runIndex, run] of file.runs.entries()) {
      // One malformed run must not take the whole upload down with it. Everything
      // in here reads caller-supplied SARIF, and a document carries many runs: an
      // exception used to escape mid-loop with the earlier runs already inserted
      // and the module quality never updated, leaving a half-imported document
      // behind and answering the request with a 500.
      try {
        let rulesWarnings = {}, rulesViolations = {}, rulesNotes = {};
        // The whole catalog, driver plus extensions - CodeQL declares its queries
        // in an extension and leaves driver.rules empty (see collectRules).
        const declaredRules = collectRules(run);
        if(run && run.results){
          for (const result of run.results) {
            // Falls back to the declared rule for whatever the result leaves out. The
            // lookup handles ruleIndex 0, which the previous truthiness check dropped.
            const severity = resolveResultSeverity(result, declaredRules)
            if(severity){
              countRules(severity.level, severity.ruleId, rulesViolations, rulesWarnings, rulesNotes)
            }
          }
        }
        const testFile = {
          type: type.toUpperCase(),
          submitted,
          companyId: companyIdentifier,
          demo: demo === true || undefined,
          analysisId,
          moduleId,
          scanId,
          projectName,
          moduleName,
          data: JSON.stringify(run),
          status: Utils.getRunStatusCode(run),
          rules: {
            // The tool's declared rule catalog, which is not the same as the rules it
            // applied to the scanned files - the UI labels it as such.
            total: declaredRules && declaredRules.length || 0,
            warnings: rulesWarnings ? Object.keys(rulesWarnings).length : 0,
            violations: rulesViolations ? Object.keys(rulesViolations).length : 0,
            notes: rulesNotes ? Object.keys(rulesNotes).length : 0,
            byRule: {
              warnings: rulesWarnings,
              violations: rulesViolations,
              notes: rulesNotes
            },
            // Findings per weakness, for the findings list. Keyed by
            // CWE id, which - unlike the rule ids in byRule - needs no escaping to
            // be a Mongo key. Each entry also names the rules that put findings
            // under it, which is what stops a manual assignment counting the same
            // finding a second time.
            // Rules that declare no CWE contribute nothing; the map is simply
            // empty for a tool that emits none.
            byCwe: collectRunCwes(run)
          },
          tool: run && run.tool && run.tool.driver && run.tool.driver.name
        };
        const testId = await Tests.insertAsync(testFile);
        tests.push(testId)
        if(!hasOwn(statuses, testFile.tool)){
          setOwn(statuses, testFile.tool, {ok: 0, warnings: 0, violations: 0})
        }
        // One run contributes one unit to the bar - see getRunQualityBucket for why it
        // is no longer derived from the declared rule catalog.
        statuses[testFile.tool][getRunQualityBucket(testFile.rules, testFile.status)] += 1;
      } catch (error) {
        // The reason is logged rather than returned: it can quote a rule id or a
        // tool name out of the uploaded document, which does not belong in an
        // API response.
        console.error('testImports/create: run ' + runIndex + ' could not be imported -',
          (error && error.message) || error);
      }
    }
    // Every run failed, so there is nothing to report and nothing was written.
    // Say so rather than answering 200 with an empty list of test ids.
    if(!tests.length){
      throw new Meteor.Error(400, 'No test run of this document could be imported');
    }
    if(moduleId){
      const module = await Modules.findOneAsync(moduleId, {fields: {quality: 1}});
      let quality;
      if(!scanId || (module && module.quality && !module.quality.scanId) || (module && module.quality && module.quality.scanId !== scanId)){
        quality = {
          tools: statuses
        }
        if(scanId){
          quality.scanId = scanId
        }
      }else if(module && module.quality && module.quality.scanId === scanId){
        quality = module.quality;
        for (const tool in statuses) {
          if (tool && hasOwn(statuses, tool)) {
            setOwn(quality.tools, tool, statuses[tool])
          }
        }
      }
      await Modules.updateAsync(moduleId, {$set: {quality: quality}});
    }
    callback(tests)
  }else {
    throw new Meteor.Error(400, 'Test runs not found');
  }
  return {tests}
};

export default create;
