import {Meteor} from 'meteor/meteor';
import Approves from '/imports/lib/collections/approves';

const countApprovedProjectApproves = async function (projectId, moduleId, filter) {
  // Scope the count to the caller's company; a client-supplied filter is only
  // honored for trusted server-side calls (no DDP user).
  const user = await Meteor.userAsync();
  const companyId = user ? (user.profile && user.profile.companyId) : (filter && filter.companyId);
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let query = (!user && filter && typeof filter === 'object')
    ? Object.assign({}, filter)
    : {projectId, approved: {$exists: true}};
  if(moduleId){
    query.moduleId = moduleId
  }
  query.companyId = companyId;
  return await Approves.find(query).countAsync();
};

export default countApprovedProjectApproves;
