import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Components from '/imports/lib/collections/components';

const create = async function (component) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['company_component_manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (await Components.findOneAsync({key: component.key})) {
    throw new Meteor.Error(400, 'Component with same key already exists');
  } else {
    component.key = component.key.toLowerCase();
    let componentId = await Components.insertAsync(component);
    if(componentId){
      await Meteor.callAsync('logEvent', user, 'New component created '+component.key, 'componentCreated');
    }
    return componentId
  }
};

export default create;
