import {Meteor} from 'meteor/meteor';
import QualityProperties from '/imports/lib/collections/qualityProperties';
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
  let companySettings = await QualityProperties.find({companyId, projectId: {$exists: false}, moduleId: {$exists: false}}).fetchAsync()
  if(params.moduleId || params.projectId){
    companySettings.map(function (elem) {
      elem.companyItem = true;
      return elem
    });
  }
  list = list.concat(companySettings)
  if(params.projectId){
    let projectSettings = await QualityProperties.find({companyId, projectId: params.projectId, moduleId: {$exists: false}}).fetchAsync()
    if(params.moduleId){
      projectSettings.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
    }
    list = list.concat(projectSettings)
  }
  if(params.moduleId){
    let moduleSettings = await QualityProperties.find({companyId, projectId: {$exists: false}, moduleId: params.moduleId}).fetchAsync()
    list = list.concat(moduleSettings)
  }
  return list;
};

export default find;
