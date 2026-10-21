import {Meteor} from 'meteor/meteor';
import Capabilities from '/imports/lib/collections/capabilities';
import Utils from '/imports/lib/utils';

const create = async function (params) {
  const user = await Meteor.userAsync();
  if (!user || !user.profile || !user.profile.companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let doc = {
    created: new Date(),
    userId: user._id,
    // The caller's name: Utils.username() alone has no user on the server.
    userName: Utils.username(user),
    companyId: user.profile.companyId,
    projectId: params.projectId,
    moduleId: params.moduleId,
    name: params.name,
    version: params.version,
    description: params.description
  };
  let result = await Capabilities.insertAsync(doc);
  if(result){
    await Meteor.callAsync('logEvent', user, 'Capabilities ' + doc.name + ' created', 'capabilitiesCreate');
    return result
  }else{
    return false
  }
};

export default create;
