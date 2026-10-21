import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Licenses from '/imports/lib/collections/licenses';
import LicensesService from '/imports/api/licenses';
import {
  LICENSE_EDITOR_ROLES, findIdentifierClash, identifierClashMessage, validateLicenseInput
} from '/imports/lib/licenses/licenseInput';

// Licenses.Update - replace the editable fields (name, url, aliases, text, copyright)
// of one license. The key never changes: components and module settings refer to it.
const update = async function (key, input) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, LICENSE_EDITOR_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof key !== 'string' || !key) {
    throw new Meteor.Error(400, 'Invalid license key');
  }
  const result = validateLicenseInput(input, 'update');
  if (result.error) {
    throw new Meteor.Error(400, result.error);
  }
  const license = await Licenses.findOneAsync({key: key}, {fields: {_id: 1, key: 1}});
  if (!license) {
    throw new Meteor.Error(404, 'License not found');
  }
  // A custom license whose name or alias equals another license's key, name or alias
  // breaks key/name/alias resolution (imports/api/licenses.js, licenseMatch.js) for
  // every company that shares this catalog. The license being updated is excluded from
  // `others` by _id, so its own key/name/aliases never clash with themselves.
  const others = await Licenses.find(
    {_id: {$ne: license._id}}, {fields: {key: 1, name: 1, aliases: 1}}).fetchAsync();
  const clash = findIdentifierClash({key: license.key, name: result.doc.name, aliases: result.doc.aliases || []}, others);
  if (clash) {
    throw new Meteor.Error(400, identifierClashMessage(clash));
  }
  const modifier = {$set: Object.assign({}, result.doc, {updated: new Date()})};
  if (result.cleared.length) {
    modifier.$unset = {};
    result.cleared.forEach(function (field) {
      modifier.$unset[field] = '';
    });
  }
  await Licenses.updateAsync({_id: license._id}, modifier);
  await LicensesService.init();
  await Meteor.callAsync('logEvent', user, 'License ' + key + ' has been updated', 'licenseUpdated');
  return key;
};

export default update;
