import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Companies from '/imports/lib/collections/companies';
import {encrypt} from '/imports/lib/crypto';
import {assertSafePublicUrl} from '/imports/lib/security/ssrfGuard';

const updateJira = async function (newSettings) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // SSRF input gate: reject an internal/invalid Jira base URL on save (the url
  // field is optional). Egress validation at fetch time is the authoritative
  // layer; this gives the user immediate, clear feedback.
  if (newSettings && newSettings.url) {
    try {
      assertSafePublicUrl(newSettings.url);
    // The original error carries SSRF detail we must not surface to the client;
    // discard it and throw a generic 400.
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (e) {
      throw new Meteor.Error(400, 'Invalid integration URL');
    }
  }
  // The password is no longer published to the client, so a blank value on save
  // means "keep the existing credential" rather than overwriting it with empty.
  if (Object.prototype.hasOwnProperty.call(newSettings, 'passwd')) {
    if (newSettings.passwd) {
      newSettings.passwd = encrypt(newSettings.passwd);
    } else {
      const company = await Companies.findOneAsync(companyId, {fields: {'jira.passwd': 1}});
      if (company && company.jira && company.jira.passwd) {
        newSettings.passwd = company.jira.passwd;
      } else {
        delete newSettings.passwd;
      }
    }
  }
  let modifier = {$set: {'jira': newSettings}};
  if(Object.keys(newSettings).length === 1 && Object.keys(newSettings)[0] === 'type'){
    modifier = {$set: {'jira.type': newSettings.type}}
  }
  const cnt = await Companies.updateAsync(companyId, modifier);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not update db');
  }
};

export default updateJira;
