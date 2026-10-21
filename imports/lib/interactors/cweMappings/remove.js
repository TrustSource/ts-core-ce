import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import CweMappings from '/imports/lib/collections/cweMappings';
import {normalizeTool, CWE_MAPPING_RULE_ID_MAX, CWE_MAPPING_TOOL_MAX} from '/imports/lib/sarif/cweMappingOverlay';
import {CWE_MAPPING_WRITE_ROLES} from './roles';

function requiredString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

// Withdraw an assignment. The selector is scoped to the caller's
// own company, so a global default is never reachable from here - removing one
// affects every customer and belongs to ts-app-admin.
const remove = async function (params) {
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
  // The same bounds set.js applies, so an id no mapping could ever have been
  // stored under is refused here instead of becoming an unbounded selector value.
  const tool = requiredString(params && params.tool, CWE_MAPPING_TOOL_MAX) ?
    normalizeTool(params.tool) : '';
  const ruleId = requiredString(params && params.ruleId, CWE_MAPPING_RULE_ID_MAX) ?
    params.ruleId.trim() : '';
  if (!tool || !ruleId) {
    throw new Meteor.Error(400, 'A tool and a rule are required');
  }
  const removed = await CweMappings.removeAsync({companyId, tool, ruleId});
  if (removed) {
    await Meteor.callAsync('logEvent', user,
      'CWE mapping withdrawn from rule ' + ruleId + ' (' + tool + ')', 'cweMappingRemoved');
  }
  return removed;
};

export default remove;
