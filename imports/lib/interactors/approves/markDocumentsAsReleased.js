import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Approves from '/imports/lib/collections/approves';
import Scans from '/imports/lib/collections/scans';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Utils from '/imports/lib/utils';
import {tsWebhook} from '/imports/startup/server/ts-webhook';
import {ensureReleaseKey} from '/imports/server/releaseKeys';
import {resolveActingUser} from '/imports/server/security/actingUser';

const AD = 'Access Denied'

const markDocumentsAsReleased = async function (user, approvalId, apiUser) {
  // A client connection acts as its session user, never as a user object from
  // the arguments; server code (Approves.Approve, the REST route) passes its own.
  const fromClient = !!(this && this.connection);
  const userData = await resolveActingUser(this, user || apiUser);
  if (!userData) {
    throw new Meteor.Error(403, AD);
  }
  const companyId = userData.profile && userData.profile.companyId
  // An API user's key scope was checked by the REST endpoint.
  const isApiUser = !fromClient && !user && userData === apiUser;
  if (!isApiUser && !await Roles.userIsInRole(userData._id, ['compliance_manager', 'manager'], companyId)) {
    throw new Meteor.Error(403, AD);
  }
  if(!approvalId){
    throw new Meteor.Error(400, 'approvalId is required');
  }
  let approval = await Approves.findOneAsync(approvalId)
  // Only the owning company may release an approval.
  if (!approval || approval.companyId !== companyId) {
    throw new Meteor.Error(403, AD);
  }
  let counter = 0;
  if(approval && approval.modules){
    let modifier = {
      '$set': {
        released: true
      }
    }
    for (const module of approval.modules) {
      if(module.scanId){
        await Scans.updateAsync(module.scanId, modifier)
      }
      if(module.analysisId){
        await ModuleAnalysis.updateAsync(module.analysisId, modifier)
      }
    }
  }
  // The release key is created without a session, so an approval through the REST
  // API gets one too; approving again keeps the existing key.
  try {
    const releaseKey = await ensureReleaseKey(companyId, approvalId, {published: true});
    await Meteor.callAsync('logEvent', userData, 'Public Release key for release '+approvalId+' published',
      'publicReleaseKeyProcessing');
    counter = releaseKey ? 1 : 0;
  } catch (error) {
    await Meteor.callAsync('logEvent', userData, 'Error: '+error.message, 'publicReleaseKeyProcessing');
  }
  try {
    await tsWebhook({
      companyId: companyId,
      projectId: approval && approval.projectId,
      projectName: approval && approval.project() && approval.project().name,
      trigger: 'release',
      data: {
        _id: approvalId,
        approved: new Date(),
        closedBy: userData._id,
        closedByName: Utils.username(userData)
      }
    });
  }catch (e) {console.log(e)}
  return counter
};

export default markDocumentsAsReleased;
