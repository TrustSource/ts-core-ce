import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Webhooks from '/imports/lib/collections/webhooks';
import {WEBHOOK_ADMIN_ROLES} from '/imports/lib/company/webhookAccess';
import {revealSigningSecret} from '/imports/server/security/webhookSecrets';

// The signing secret a receiver needs to verify X-TrustSource-Signature.
const revealSecret = async function (_id) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRoleAsync(user._id, WEBHOOK_ADMIN_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof _id !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  const row = await Webhooks.findOneAsync({_id, companyId}, {fields: {name: 1, secret: 1}, transform: null});
  if (!row) {
    throw new Meteor.Error(404, 'Webhook not found');
  }
  const secret = revealSigningSecret(row);
  await Meteor.callAsync('logEvent', user, 'Signing secret of webhook ' + row.name + ' copied', 'webhooksCreated');
  return secret;
};

export default revealSecret;
