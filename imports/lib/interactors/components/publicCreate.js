import {Meteor} from 'meteor/meteor';
import Components from '/imports/lib/collections/components';
import Component from '/imports/lib/component/Component';
import {clearSpdxKey as sharedClearSpdxKey} from '/imports/lib/component/keyFromPurl';

function clearSpdxKey(key){
  let cleaned = sharedClearSpdxKey(key);
  if(cleaned.match(/\s/)){
    cleaned = cleaned.split(' ').join('_');
  }
  return cleaned.toLowerCase();
}
const PublicCreate = async function (params) {
  let user = await Meteor.userAsync();
  if (!user) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const component = new Component({
    key: clearSpdxKey(`${params.pkgType}:${params.pkgName}`),
    name: params.pkgName
  });

  component.setUrl('repository', params.pkgRepo);
  component.setToBeResearched(true);

  ([params.pkgVersion]).forEach(function (version) {
    component.getVersion(version);
  });

  if (await Components.findOneAsync({key: component.getKey()})) {
    throw new Meteor.Error(400, 'Component with same key already exists');
  } else {
    let componentId = await Components.insertAsync(component.data());
    if(componentId){
      await Meteor.callAsync('logEvent', user, 'New component created '+component.getKey(), 'componentCreated');
    }
    return component.data()
  }
};

export default PublicCreate;
