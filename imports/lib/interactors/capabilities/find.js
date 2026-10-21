import {Meteor} from 'meteor/meteor';
import Capabilities from '/imports/lib/collections/capabilities';
import {asString} from '/imports/lib/security/sanitizeQuery';

const find = async function (params) {
  const user = await Meteor.userAsync();
  // Authenticated client calls are scoped to their own company; only trusted
  // server-side calls (no DDP user) may supply a companyId.
  const companyId = user ? (user.profile && user.profile.companyId) : params.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  return await Capabilities.find({companyId, moduleId: asString(params.moduleId)}).fetchAsync();
};

export default find;
