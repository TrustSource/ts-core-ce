import {Meteor} from 'meteor/meteor';
import Tasks from '/imports/lib/collections/tasks';

const update = async function (_id, filter, modifier, apiUser) {
  let user = await Meteor.userAsync();
  if (!user) {
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }
  // Always scope to the caller's company. A raw filter is only honored on the
  // trusted REST path (apiUser); a DDP client may only target its own record.
  const companyId = user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let query;
  if (apiUser && filter && typeof filter === 'object') {
    query = Object.assign({}, filter, {companyId});
  } else {
    if (typeof _id !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    query = {_id, companyId};
  }
  const docId = await Tasks.updateAsync(query, modifier);
  if(docId){
    await Meteor.callAsync('logEvent', user, 'Task updated', 'tasksUpdate');
  }
  return docId
};

export default update;
