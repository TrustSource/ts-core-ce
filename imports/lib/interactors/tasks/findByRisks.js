import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules';
import RiskProperties from '/imports/lib/collections/riskProperties';
import Tasks from '../../collections/tasks';
import {asString} from '/imports/lib/security/sanitizeQuery';


const findByRisks = async function (params) {
  const user = await Meteor.userAsync();
  // Authenticated client calls are scoped to their own company; only trusted
  // server-side calls (no DDP user) may supply a companyId.
  const companyId = user ? (user.profile && user.profile.companyId) : params.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  params.moduleId = asString(params.moduleId);
  params.projectId = asString(params.projectId);
  params.name = asString(params.name);
  let list = []
  if(params.moduleId){
    let filter  = {companyId, projectId: {$exists: false}, moduleId: params.moduleId}
    if(params.name){
      filter.name = params.name
    }
    let moduleSettings = await RiskProperties.find(filter, {fields: {_id: true}}).fetchAsync()
    list = list.concat(moduleSettings)
  }else if(params.projectId){
    let filter = {companyId, projectId: params.projectId, moduleId: {$exists: false}}
    if(params.name){
      filter.name = params.name
    }
    let projectSettings = await RiskProperties.find(filter, {fields: {_id: true}}).fetchAsync()
    list = list.concat(projectSettings)
    const modules = await Modules.find({companyId, projectId: params.projectId}, {fields:{_id:true}}).fetchAsync()
    const moduleIds = modules.map(m => m._id)
    let moduleFilter = {companyId, projectId: {$exists: false}, moduleId: {$in: moduleIds}}
    if(params.name){
      moduleFilter.name = params.name
    }
    let moduleSettings = await RiskProperties.find(moduleFilter, {fields: {_id: true}}).fetchAsync()
    moduleSettings.map(function (elem) {
      elem.moduleItem = true;
      return elem
    });
    list = list.concat(moduleSettings)
  }
  const riskIds = list.map(m => m._id)
  return Tasks.find({companyId, riskId: {$in:riskIds}}).fetchAsync();
};

export default findByRisks;
