import _ from 'underscore';
import {Meteor} from 'meteor/meteor';
import Messages from '/imports/lib/collections/messages';
import Modules from '/imports/lib/collections/modules';
import {resolveMessageAttribution} from '/imports/server/security/messageAttribution';

async function sendMessageToFollowers(senderId, moduleId, componentKey, status, message, type) {
  let module = await Modules.findOneAsync({_id:moduleId}, {fields: {name: 1, relatedUsers: 1, projectId: 1}});
  if(module && module.relatedUsers && module.relatedUsers.followers){
    for (const userId of module.relatedUsers.followers) {
      let newMessage = {
        userId: userId,
        senderId: senderId,
        companyId: module.companyId,
        projectId: module.projectId,
        moduleId: module._id,
        componentKey: componentKey,
        status: status,
        message: message+' in module '+module.name+(status?' new status '+status : '')+' - component '+componentKey,
        type: type
      };
      await Meteor.callAsync('Messages.Create',newMessage, true);
    }
  }
}

const create = async function ({userId, approveId, projectId, moduleId, componentKey,
  subject, message, status, type, senderId}, noLogs) {
  // Distinguish a trusted server-internal delivery (sendMessageToFollowers + every
  // notify* helper call this via Meteor.callAsync with no DDP connection) from a
  // hostile DDP client. A client may only post a public, self-attributed message
  // in its own company - it cannot spoof `senderId` nor target a `userId`
  // recipient (which would allow cross-tenant message injection). `this` is the
  // method invocation because `create` is the literal Messages.Create handler.
  let attribution;
  try {
    attribution = resolveMessageAttribution(this, {userId, senderId});
  } catch (e) {
    throw new Meteor.Error(e.error || 403, e.reason || 'Access Denied');
  }
  userId = attribution.userId;
  senderId = attribution.senderId;

  const user = await Meteor.users.findOneAsync(userId  || senderId);
  const sender = await Meteor.users.findOneAsync(senderId);
  // The message is scoped to the sender's company. On the client path `senderId`
  // is pinned to the authenticated caller, so this resolves to the caller's
  // tenant - there is no way to attribute a message to another company.
  const now = new Date();
  const doc = {
    userId,
    approveId,
    projectId,
    moduleId,
    componentKey,
    subject,
    message,
    status,
    type,
    companyId: user.profile.companyId,
    senderId,
    senderName: (sender && ((sender.profile && sender.profile.name) || (sender.emails && sender.emails[0].address)) || 'TrustSource')
    ,
    created: new Date()
  };
  if(!doc.userId){
    doc.public = true
  }
  if((status && type === 'changeComponentStatus') || type === 'resetComponentStatus' || type === 'componentComment'){
    // Cross-tenant write guard. This side-effect UPDATES the module
    // (componentConfig.changedStatus) and fans notifications to its followers.
    // moduleId is client-supplied, so it MUST be string-validated (operator-injection
    // guard) and the lookup scoped to the message's company - NOT resolved by raw id.
    // The scope is bound to the already-resolved sender's company (the same value
    // written to the message doc), which works for BOTH paths: on the client path
    // senderId is pinned to the caller so this is the caller's company; on the
    // server-internal follower fan-out the recipient belongs to the module's company.
    // Do NOT branch on this.connection - bind to the derived companyId instead.
    if (typeof moduleId !== 'string' || !moduleId) {
      throw new Meteor.Error(400, 'Invalid id');
    }
    const companyId = user && user.profile && user.profile.companyId;
    const module = await Modules.findOneAsync({_id: moduleId, companyId});
    // A moduleId that does not resolve within the sender's company is a cross-tenant
    // reference - deny and perform neither the update nor sendMessageToFollowers.
    if (!module) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    const arr = module.getChangedStatusComponents();
    let filteredArr = _.reject(arr, function (e) {
      return e.key === componentKey;
    });
    if(type === 'changeComponentStatus' || type === 'componentComment'){
      const comment = message + '  By ' + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email) || 'User')
        + ', ' + now.toLocaleDateString();
      filteredArr.push({key: componentKey, version: '*', status, comment});
    }
    const setObject = {};
    setObject['componentConfig.changedStatus'] = _.sortBy(filteredArr, 'key');
    try {
      const data = await Modules.updateAsync(module._id, {$set: setObject});
      if (data === 1 && !noLogs) {
        if(type === 'resetComponentStatus'){
          await Meteor.callAsync('logEvent', user, 'Status for component '+componentKey+' was reset. In module '+module.name,
            'componentStatusUpdated');
        }else if (type === 'changeComponentStatus'){
          await Meteor.callAsync('logEvent', user, 'Status for component '+componentKey +
            ' changed to '+status+ ' with comment: '+message +' . In module '+module.name, 'componentStatusUpdated');
        }
        await sendMessageToFollowers(senderId, moduleId, componentKey, status, message, type)
      }
    } catch (error) {
      console.log('Error updating Module:', error);
    }
  }
  await Messages.insertAsync(doc);
};

export default create;
