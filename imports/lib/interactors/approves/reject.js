import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Utils from '/imports/lib/utils';
import Approves from '/imports/lib/collections/approves';
import ApprovesUpdate from './update';
import {tsWebhook} from '/imports/startup/server/ts-webhook';
import {resolveActingUser} from '/imports/server/security/actingUser';

const reject = async function (_id, reason, apiUser) {
  // A client connection acts as its session user, never as a user object from
  // the arguments; the REST route (no connection) passes the API key's user.
  const fromClient = !!(this && this.connection);
  const user = await resolveActingUser(this, apiUser);
  if (!user) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // An API user's key scope was checked by the REST endpoint.
  const isApiUser = !fromClient && !!apiUser && user === apiUser;
  const restUser = isApiUser ? apiUser : undefined;
  if (!isApiUser && !await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], user.profile && user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Tenant isolation: verify the approval belongs to the caller's company
  // before the write and the notify side effects run on _id.
  const existingApproval = await Approves.findOneAsync(_id, {fields: {companyId: 1}});
  if (!existingApproval || existingApproval.companyId !== (user.profile && user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let modifier = {
    '$set': {
      rejectedReason: reason,
      rejected: new Date(),
      closedBy: user._id,
      closedByName: Utils.username(user)
    }
  };
  let state = await ApprovesUpdate(modifier, _id, null, restUser);
  try {
    await Meteor.callAsync('notifyAboutApprovedOrRejected', (isApiUser ? null : user), _id, restUser);
    const approval = await Approves.findOneAsync(_id, {fields: {projectId: 1}})
    await tsWebhook({
      companyId: user.profile.companyId,
      projectId: approval && approval.projectId,
      projectName: approval && approval.project() && approval.project().name,
      trigger: 'approval',
      data: {
        _id,
        rejectedReason: reason,
        rejected: new Date(),
        closedBy: user._id,
        closedByName: Utils.username(user)
      }
    });
  }catch (e) {console.log(e)}
  return state
};

export default reject;
