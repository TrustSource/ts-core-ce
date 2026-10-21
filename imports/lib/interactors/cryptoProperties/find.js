import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules';
import CryptoProperties from '/imports/lib/collections/cryptoProperties';
import {asString} from '/imports/lib/security/sanitizeQuery';

const find = async function (params) {
  const user = await Meteor.userAsync();
  // Authenticated client calls are scoped to their own company; only trusted
  // server-side calls (no DDP user) may supply a companyId.
  const companyId = user ? (user.profile && user.profile.companyId) : params.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  params.moduleId = asString(params.moduleId);
  params.projectId = asString(params.projectId);
  let list = []
  if(params.moduleId){
    let moduleSettings = await CryptoProperties.find({companyId, projectId: {$exists: false}, moduleId: params.moduleId}).fetchAsync()
    list = list.concat(moduleSettings)
  }else if(params.projectId){
    let projectSettings = await CryptoProperties.find({companyId, projectId: params.projectId, moduleId: {$exists: false}}).fetchAsync()
    list = list.concat(projectSettings)
    const modules = await Modules.find({companyId, projectId: params.projectId}, {fields:{_id:true}}).fetchAsync()
    const moduleIds = modules.map(m => m._id)
    let moduleSettings = await CryptoProperties.find({companyId, projectId: {$exists: false}, moduleId: {$in: moduleIds}}).fetchAsync()
    moduleSettings.map(function (elem) {
      elem.moduleItem = true;
      return elem
    });
    list = list.concat(moduleSettings)
  }
  return list;
};

export default find;
