import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import Utils from '/imports/lib/utils';
import {
  DUPLICATE_KEY_MESSAGE, DUPLICATE_NAME_MESSAGE, INFRASTRUCTURE_COMPONENT_KEY_PREFIX,
  normalizeInfrastructureComponentKey, sameValuePattern, validateInfrastructureComponentInput
} from '/imports/lib/component/infrastructureComponentInput';

// InfrastructureComponents.Create - add a component to the infrastructure catalog every
// company on the install shares. Gate order: role, input, duplicate key and name, write.
const create = async function (input) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['company_component_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const result = validateInfrastructureComponentInput(input);
  if (result.error) {
    throw new Meteor.Error(400, result.error);
  }
  const doc = result.doc;
  if (!doc.key) {
    const derived = normalizeInfrastructureComponentKey(
      INFRASTRUCTURE_COMPONENT_KEY_PREFIX + Utils.generateModuleIdentifier(doc.name));
    if (derived.error) {
      throw new Meteor.Error(400, derived.error);
    }
    doc.key = derived.value;
  }
  // Soft-removed components count: their key still resolves modules that link to them.
  if (await InfrastructureComponents.findOneAsync({key: sameValuePattern(doc.key)}, {fields: {_id: 1}})) {
    throw new Meteor.Error(400, DUPLICATE_KEY_MESSAGE);
  }
  if (await InfrastructureComponents.findOneAsync({name: sameValuePattern(doc.name)}, {fields: {_id: 1}})) {
    throw new Meteor.Error(400, DUPLICATE_NAME_MESSAGE);
  }
  const id = await InfrastructureComponents.insertAsync(Object.assign(doc, {
    created: new Date(),
    createdBy: Utils.username(user)
  }));
  await Meteor.callAsync('logEvent', user, 'Infrastructure component ' + doc.name + ' created',
    'infrastructureComponentCreated');
  return id;
};

export default create;
