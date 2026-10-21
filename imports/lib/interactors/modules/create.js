import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import COTSComponents from '/imports/lib/collections/cotsComponents';
import Utils from '/imports/lib/utils';

const create = async function (module) {
  let user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Force the tenant server-side - never trust a client-supplied companyId.
  module.companyId = companyId;
  // If attached to a project, that project must belong to the caller's company.
  if (module.projectId) {
    const project = await Projects.findOneAsync({_id: module.projectId, companyId}, {fields: {_id: 1}});
    if (!project) {
      throw new Meteor.Error(403, 'Access Denied');
    }
  }
  if(!module.commercialTerms){
    module.commercialTerms = {}
  }
  let newId = await Modules.insertAsync(module);
  let component, version;
  if(newId){
    await Meteor.callAsync('logEvent', user, 'New module created', 'moduleCreated');
    if(module.infrastructureComponent){
      component = await InfrastructureComponents.findOneAsync({key: module.infrastructureComponent.key.toLowerCase()});
      version = module.infrastructureComponent.version
    }
    if(module.cotsComponent){
      component = await COTSComponents.findOneAsync({key: module.cotsComponent.key.toLowerCase()});
      version = module.cotsComponent.version
    }
    if(component){
      const user = await Meteor.userAsync();
      component.getVersion(version)
      component.store(Utils.username(), false, user);
      await Meteor.callAsync('Modules.AnalyzeWithoutScan', newId);
    }
  }
  return newId
};

export default create;
