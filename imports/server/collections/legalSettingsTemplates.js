import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import LegalSettingsTemplates from '/imports/lib/collections/legalSettingsTemplates';
import Utils from '/imports/server/ServerUtils';
import {LEGAL_TEMPLATE_ROLES} from '/imports/lib/company/settingsAccess';

const AD = 'Access Denied'

Meteor.publish('companyLegalSettingsTemplates', async function (type) {
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  // Meteor drops an undefined value from a selector rather than matching only
  // documents where the field is undefined, so a bare `companyId: companyId`
  // here would publish every company's templates to a user without one.
  if (!companyId) {
    return this.ready();
  }
  let filter = {companyId: companyId};
  if(type){
    filter.type = type;
  }
  return LegalSettingsTemplates.find(filter, {sort: {order: -1}})
});
Meteor.publish('availableLegalSettingsTemplates', async function (type) {
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return this.ready();
  }
  let filter = {companyId: companyId};
  if(type){
    filter.type = type;
  }
  return LegalSettingsTemplates.find(filter, {sort: {order: -1}})
});

Meteor.publish('legalSettingsTemplateDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !_id) {
    return this.ready();
  }
  // A user may see only a template owned by their own company.
  return LegalSettingsTemplates.find({_id: _id, companyId: companyId});
});

// Only company templates can be written, by an Account admin or Compliance manager
// of the owning company.
// A company-less (system-wide) template is not managed in this edition.
async function isCompanyTemplateAdmin(userId, doc) {
  if (!userId || !doc || !doc.companyId) {
    return false;
  }
  const user = await Meteor.users.findOneAsync(userId);
  const companyId = user && user.profile && user.profile.companyId;
  return !!(companyId && companyId === doc.companyId &&
    await Roles.userIsInRole(userId, LEGAL_TEMPLATE_ROLES, companyId));
}

LegalSettingsTemplates.allow({
  fetch: ['type', 'name', 'order', 'requirements', 'companyId'],
  insert: async function (userId, doc) {
    return await isCompanyTemplateAdmin(userId, doc);
  },
  update: async function (userId, doc, fieldNames) {
    if (Array.isArray(fieldNames) && fieldNames.indexOf('companyId') !== -1) {
      return false;
    }
    return await isCompanyTemplateAdmin(userId, doc);
  },
  remove: async function (userId, doc) {
    return await isCompanyTemplateAdmin(userId, doc);
  }
});

Meteor.methods({
  _updateCompanyLegalSettingsTemplate: async function (doc, legacyId) {
    // AutoForm v8 method-update sends {_id, modifier} as single object
    // Direct calls send (modifier, id) as two args
    const id = legacyId || doc._id;
    const modifier = legacyId ? doc : doc.modifier;
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId || !await Roles.userIsInRole(user._id, LEGAL_TEMPLATE_ROLES, companyId)) {
      throw new Meteor.Error(403, AD);
    }
    const $set = modifier && modifier.$set;
    if (!$set || typeof $set !== 'object' || Array.isArray($set)) {
      throw new Meteor.Error(400, 'Invalid update');
    }
    if (Object.keys($set).some((key) => key === 'companyId' || key.startsWith('companyId.'))) {
      throw new Meteor.Error(403, AD);
    }
    const data = await LegalSettingsTemplates.updateAsync({_id: id, companyId}, {$set: $set});
    if (data !== 1) {
      let textError = 'Error: could not update template';
      await Meteor.callAsync('logEvent', user, textError, 'legalSettingsTemplateUpdated');
    } else {
      await Meteor.callAsync('logEvent', user, 'Template '+id+' updated', 'legalSettingsTemplateUpdated');
    }
    return data;
  }
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawRules;

Meteor.startup(function () {
  RawRules = Utils.makeRawCollection(LegalSettingsTemplates);
  RawRules.createIndex('type');
  RawRules.createIndex('companyId');
});
