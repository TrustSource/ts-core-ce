import {Meteor} from 'meteor/meteor';
import QualityProperties from '/imports/lib/collections/qualityProperties';

const create = async function (params) {
  const user = await Meteor.userAsync();
  let doc = {
    created: new Date(),
    userId: user._id,
    userName: ((user.profile && user.profile.name)
      || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
    companyId: user.profile.companyId,
    projectId: params.projectId,
    moduleId: params.moduleId,
    toolId: params.toolId,
    name: params.name
  };
  let result = await QualityProperties.insertAsync(doc);
  if(result){
    await Meteor.callAsync('logEvent', user, 'Quality properties ' + doc.name + ' created', 'qualityPropertiesCreate');
    return result
  }else{
    return false
  }
};

export default create;
