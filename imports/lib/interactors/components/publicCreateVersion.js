import {Meteor} from 'meteor/meteor';
import Components from '/imports/lib/collections/components';
import Utils from '/imports/lib/utils';

const PublicCreateVersion = async function (params) {
  let user = await Meteor.userAsync();
  if (!user) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const component = await Components.findOneAsync({key: params.component.key});

  let newVersion;
  ([params.pkgVersion]).forEach(function (version) {
    newVersion = component.getVersion(version);
    newVersion.setToBeResearched(true);
  });

  const status = component.store(Utils.username(user))
  if(status){
    await Meteor.callAsync('logEvent', user, 'New component version created for '+component.getKey(), 'componentUpdated');
  }
  return newVersion.data()
};

export default PublicCreateVersion;
