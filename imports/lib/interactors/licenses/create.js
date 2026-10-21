import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Licenses from '/imports/lib/collections/licenses';
import LicensesService from '/imports/api/licenses';
import {
  DUPLICATE_KEY_MESSAGE, LICENSE_EDITOR_ROLES, findIdentifierClash, identifierClashMessage,
  sameKeyPattern, validateLicenseInput
} from '/imports/lib/licenses/licenseInput';

// Licenses.Create - add a license to the catalog every company on the install shares.
// Gate order: role, input, duplicate key, write, cache refresh.
const create = async function (input) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, LICENSE_EDITOR_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const result = validateLicenseInput(input, 'create');
  if (result.error) {
    throw new Meteor.Error(400, result.error);
  }
  const doc = result.doc;
  // Ignoring case: license matching compares keys lowercased, so `mit` beside `MIT`
  // would be one license to it and two to the catalog.
  if (await Licenses.findOneAsync({key: sameKeyPattern(doc.key)}, {fields: {_id: 1}})) {
    throw new Meteor.Error(400, DUPLICATE_KEY_MESSAGE);
  }
  // A custom license whose name or alias equals another license's key, name or alias
  // breaks key/name/alias resolution (imports/api/licenses.js, licenseMatch.js) for
  // every company that shares this catalog.
  const others = await Licenses.find({}, {fields: {key: 1, name: 1, aliases: 1}}).fetchAsync();
  const clash = findIdentifierClash(doc, others);
  if (clash) {
    throw new Meteor.Error(400, identifierClashMessage(clash));
  }
  try {
    await Licenses.insertAsync(Object.assign({}, doc, {created: new Date()}));
  } catch (e) {
    // Two creates racing past the lookup: the unique index on `key` answers the second.
    if (e && (e.code === 11000 || /E11000/.test(e.message || ''))) {
      throw new Meteor.Error(400, DUPLICATE_KEY_MESSAGE);
    }
    throw e;
  }
  // matchLicense and the pickers read this cache; refresh it so the new key is known now.
  await LicensesService.init();
  await Meteor.callAsync('logEvent', user, 'New license ' + doc.key + ' has been created', 'licenseCreated');
  return doc.key;
};

export default create;
