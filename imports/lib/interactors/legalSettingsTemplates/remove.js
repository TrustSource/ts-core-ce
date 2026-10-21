import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import LegalSettingsTemplates from '/imports/lib/collections/legalSettingsTemplates';
import {LEGAL_TEMPLATE_ROLES} from '/imports/lib/company/settingsAccess';

// Removes one of the caller's company legal settings templates (account_admin).
// A company-less (system-wide) template is not managed in this edition.
const remove = async function (templateId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof templateId !== 'string') {
    throw new Meteor.Error(400, 'Invalid template id');
  }
  const template = await LegalSettingsTemplates.findOneAsync(templateId, {fields: {companyId: 1}});
  if (!template) {
    throw new Meteor.Error(404, 'Template not found');
  }
  if (!template.companyId || template.companyId !== companyId ||
    !await Roles.userIsInRole(user, LEGAL_TEMPLATE_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await LegalSettingsTemplates.removeAsync(templateId);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not delete from db');
  }
};

export default remove;
