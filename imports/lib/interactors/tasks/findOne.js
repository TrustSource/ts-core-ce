import {Meteor} from 'meteor/meteor';
import Tasks from '/imports/lib/collections/tasks';
import {stripOperators} from '/imports/lib/security/sanitizeQuery';


const findOne = async function (params) {
  const user = await Meteor.userAsync();
  // Authenticated client calls are scoped to their own company; only trusted
  // server-side calls (no DDP user) may supply a companyId.
  const companyId = user ? (user.profile && user.profile.companyId) : params.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // params is used as the selector - strip operators so a client can't inject
  // e.g. {_id:{$gt:''}} to read another document.
  const filter = stripOperators(params || {});
  filter.companyId = companyId;
  return Tasks.findOneAsync(filter, {fields: {companyId: 0}});
};

export default findOne;
