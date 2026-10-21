import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Webhooks from '/imports/lib/collections/webhooks';
import Utils from '/imports/lib/utils';
import {assertSafePublicUrl} from '/imports/lib/security/ssrfGuard';
import {WEBHOOK_ADMIN_ROLES, projectBelongsToCompany} from '/imports/lib/company/webhookAccess';
import {sealWebhookFields} from '/imports/server/security/webhookSecrets';

const create = async function ({name, triggers, type, method, url, headers, projectId}) {
  let user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, WEBHOOK_ADMIN_ROLES, user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // SSRF input gate: reject an internal/invalid webhook target URL on save.
  try {
    assertSafePublicUrl(url);
  // The original error carries SSRF detail we must not surface to the client;
  // discard it and throw a generic 400.
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (e) {
    throw new Meteor.Error(400, 'Invalid integration URL');
  }
  const companyId = user.profile.companyId;
  // The projectId is client-supplied and was written straight through, so a row
  // could be filed against another tenant's project.
  if (!await projectBelongsToCompany(projectId, companyId)) {
    throw new Meteor.Error(400, 'Invalid project');
  }
  let doc = {
    created: new Date(),
    companyId: companyId,
    projectId: projectId,
    userId: user._id,
    userName: Utils.username(user),
    name,
    type,
    triggers,
    method,
    // The url, header values and signing secret are stored encrypted (webhookSecrets.js).
    ...sealWebhookFields({url, headers: Array.isArray(headers) && headers.length ? headers : undefined})
  };
  let docId = await Webhooks.insertAsync(doc);
  if(docId){
    await Meteor.callAsync('logEvent', user, 'Webhook ' + name, 'webhooksCreated');
  }
  return docId
};

export default create;
