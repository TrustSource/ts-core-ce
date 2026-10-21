import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {encrypt} from '/imports/lib/crypto';
import {assertSafePublicUrl} from '/imports/lib/security/ssrfGuard';

const updateTfs = async function (newSettings) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // SSRF input gate: the TFS `account` may be a bare slug (expanded to a fixed
  // *.visualstudio.com URL - out of scope) OR a full URL-form value. Validate
  // only the URL-form (collectionUrl uses it verbatim when it matches this).
  // A leading-"/" relative form has no public host and is rejected by the gate.
  if (newSettings && typeof newSettings.account === 'string' && /(https?:\/\/|\/)/.test(newSettings.account)) {
    try {
      assertSafePublicUrl(newSettings.account);
    // The original error carries SSRF detail we must not surface to the client;
    // discard it and throw a generic 400.
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (e) {
      throw new Meteor.Error(400, 'Invalid integration URL');
    }
  }
  // Blank token on save means "keep existing credential" (no longer published).
  if (Object.prototype.hasOwnProperty.call(newSettings, 'token')) {
    if (newSettings.token) {
      newSettings.token = encrypt(newSettings.token)
    } else {
      const company = await Companies.findOneAsync(companyId, {fields: {'tfs.token': 1}});
      if (company && company.tfs && company.tfs.token) {
        newSettings.token = company.tfs.token;
      } else {
        delete newSettings.token;
      }
    }
  }
  const cnt = await Companies.updateAsync(companyId, {$set: {'tfs': newSettings}});
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateTfs;
