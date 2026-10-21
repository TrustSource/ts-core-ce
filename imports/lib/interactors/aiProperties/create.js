import {Meteor} from 'meteor/meteor';
import AiProperties from '/imports/lib/collections/aiProperties';

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
    name: params.name,
    comment: params.comment,
    used: params.used,
    origin: params.origin,
    type: params.type || 'machine-learning-model',
    version: params.version,
    purl: params.purl,
    provider: params.provider,
    task: params.task,
    modelFamily: params.modelFamily,
    architecture: params.architecture,
    modelCard: (params.modelCard && typeof params.modelCard === 'object') ? params.modelCard : undefined
  };
  let result = await AiProperties.insertAsync(doc);
  if(result){
    await Meteor.callAsync('logEvent', user, 'AI artifact ' + doc.name + ' created', 'aiPropertiesCreate');
  }
  return result
};

export default create;
