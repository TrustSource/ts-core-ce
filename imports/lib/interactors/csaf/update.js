import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Utils from '/imports/lib/utils';
import CSAF from '/imports/lib/collections/csaf';
import {sanitizeModifier, DEFAULT_PROTECTED_FIELDS} from '/imports/lib/security/sanitizeModifier';
const {extractTlp} = require('/imports/lib/csaf/feedAccess');
const {CSAF_MANAGED_FIELDS} = require('./managedFields');

// Status, publish/fail/remove results, provider, tlp and the updated* stamps are
// written only by the server flows (see managedFields.js), never by an editor.
const PROTECTED_FIELDS = DEFAULT_PROTECTED_FIELDS.concat(CSAF_MANAGED_FIELDS);

const update = async function (modifier, _id, apiUser) {
  let user = await Meteor.userAsync();
  if(!user){
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }else{
    if (!await Roles.userIsInRole(user._id, ['compliance_manager', 'company_security_manager', 'account_admin'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
  }
  // A replacement-style document would overwrite every managed field at once,
  // and sanitizeModifier only cleans operator payloads, so only operators pass.
  if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier) ||
    Object.keys(modifier).some((key) => key.charAt(0) !== '$')) {
    throw new Meteor.Error(400, 'Invalid modifier');
  }
  modifier = sanitizeModifier(modifier, {protectedFields: PROTECTED_FIELDS});
  if(!modifier['$set']){
    modifier['$set']= {};
  }
  modifier['$set'].updated = new Date();
  modifier['$set'].updatedBy = user._id;
  modifier['$set'].updatedByName = Utils.username(user);
  if (typeof modifier['$set'].data !== 'undefined') {
    const tlp = extractTlp(modifier['$set'].data);
    if (tlp) {
      modifier['$set'].tlp = tlp;
    }
  }
  await Meteor.callAsync('logEvent', user, _id, 'csafUpdated');
  const query = {_id}
  query.companyId = user.profile.companyId
  return await CSAF.updateAsync(query, modifier)
};

export default update;
