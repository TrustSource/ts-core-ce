import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import COTSComponents from '/imports/lib/collections/cotsComponents';

const analyzeWithoutScan = async function (moduleId, callback) {
  let component;
  // moduleId must be a plain string id - a selector object could match another
  // tenant's module.
  if (typeof moduleId !== 'string') {
    throw new Meteor.Error(400, 'Invalid moduleId');
  }
  let module = await Modules.findOneAsync(moduleId);
  if (!module) {
    return;
  }
  // Enforce tenant ownership for authenticated client calls. Trusted internal
  // (server-to-server) calls have no DDP user and are allowed through.
  const user = await Meteor.userAsync();
  if (user && module.companyId !== (user.profile && user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let moduleMeta = module.infrastructureComponent || module.cotsComponent
  if((module.cotsComponent && module.cotsComponent.key)){
    component = await COTSComponents.findOneAsync({key: moduleMeta.key}, {fields: {logs: 0}})
  }
  if((module.infrastructureComponent && module.infrastructureComponent.key)){
    component = await InfrastructureComponents.findOneAsync({key: moduleMeta.key}, {fields: {logs: 0}})
  }
  if(component){
    await Meteor.callAsync('analyzeModule', module._id)
  }
  if(callback){
    callback()
  }
  return module
};

export default analyzeWithoutScan;
