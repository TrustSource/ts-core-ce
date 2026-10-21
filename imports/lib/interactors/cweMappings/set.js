import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import CweMappings from '/imports/lib/collections/cweMappings';
import {normalizeCwe} from '/imports/lib/sarif/cweExtract';
import {normalizeTool, CWE_MAPPING_MAX_CWES, CWE_MAPPING_RULE_ID_MAX, CWE_MAPPING_TOOL_MAX} from '/imports/lib/sarif/cweMappingOverlay';
import {CWE_MAPPING_WRITE_ROLES} from './roles';

function requiredString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function isDuplicateKey(error) {
  return !!error && (error.code === 11000 || /E11000/.test(error.message || ''));
}

// Record the CWE(s) a human assigned to a rule the tool left unclassified.
//
// The company is taken from the caller, never from the arguments: a mapping is
// scoped data, and a client-supplied companyId is exactly the field an attacker
// would change to write into someone else's tenant.
const set = async function (params) {
  const user = await Meteor.userAsync();
  // The company scopes both the role check and the selector, so it has to be a
  // string, not merely truthy: an object here would widen the selector into
  // every tenant's mappings.
  if (!user || !user.profile || typeof user.profile.companyId !== 'string' || !user.profile.companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const companyId = user.profile.companyId;
  if (!await Roles.userIsInRole(user._id, CWE_MAPPING_WRITE_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Both strings end up in a Mongo selector and in a stored document, and both
  // are bounded by the schema. Enforcing the same bounds here means an oversized
  // value is a plain 400 rather than a collection2 validation error raised after
  // the write path has already done its work.
  const tool = requiredString(params && params.tool, CWE_MAPPING_TOOL_MAX) ?
    normalizeTool(params.tool) : '';
  const ruleId = requiredString(params && params.ruleId, CWE_MAPPING_RULE_ID_MAX) ?
    params.ruleId.trim() : '';
  if (!tool || !ruleId) {
    throw new Meteor.Error(400, 'A tool and a rule are required');
  }
  // The length is checked BEFORE the list is walked. Schema validation only runs
  // at insert, which is after the loop, so an unbounded array was a way for one
  // authenticated caller to hold the single-threaded event loop - and with it
  // every other tenant's request - for as long as they liked.
  const raw = params && Array.isArray(params.cwes) ? params.cwes : [];
  if (raw.length > CWE_MAPPING_MAX_CWES) {
    throw new Meteor.Error(400,
      'At most ' + CWE_MAPPING_MAX_CWES + ' CWE ids can be assigned to one rule');
  }
  // Normalised on the way in as well as on the way out, so what is stored is the
  // one spelling the rest of TrustSource matches on. Anything that is not a CWE
  // id is refused rather than stored as a weakness nothing will ever join up
  // with - the same principle that stops the importer guessing one. Deduped
  // through a Set, so the walk stays linear in the length of the list.
  const cwes = [];
  const seen = new Set();
  raw.forEach(function (entry) {
    const cwe = normalizeCwe(entry);
    if (cwe && !seen.has(cwe)) {
      seen.add(cwe);
      cwes.push(cwe);
    }
  });
  if (!cwes.length) {
    throw new Meteor.Error(400, 'A valid CWE id is required');
  }

  const selector = {companyId, tool, ruleId};
  const existing = await CweMappings.findOneAsync(selector, {fields: {_id: 1}});
  if (existing) {
    await CweMappings.updateAsync(existing._id, {$set: {cwes, edited: new Date()}});
  } else {
    try {
      await CweMappings.insertAsync(Object.assign({}, selector, {
        cwes,
        status: 'candidate',
        created: new Date(),
        createdBy: user._id,
        userName: (user.profile && user.profile.name) ||
          (user.emails && user.emails[0] && user.emails[0].address) || user.profile.email
      }));
    } catch (error) {
      // Meteor re-sends an outstanding method call on reconnect, so this can run
      // twice for one assignment. The unique index on
      // (companyId, tool, ruleId) turns the second run into a duplicate-key
      // error rather than a duplicate row; treat it as the update it really is,
      // so the retry succeeds instead of reporting a failure for a write that
      // landed.
      if (!isDuplicateKey(error)) {
        throw error;
      }
      await CweMappings.updateAsync(selector, {$set: {cwes, edited: new Date()}});
    }
  }
  await Meteor.callAsync('logEvent', user,
    'CWE mapping ' + cwes.join(', ') + ' assigned to rule ' + ruleId + ' (' + tool + ')',
    'cweMappingAssigned');
  return {tool, ruleId, cwes};
};

export default set;
