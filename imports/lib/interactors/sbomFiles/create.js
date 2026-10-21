import _ from 'underscore';
import {Meteor} from 'meteor/meteor';
import SbomFiles from '/imports/lib/collections/sbomFiles';
import {writeApprovalStats} from '/imports/server/approvalStats';

 
const create = async function ({projectId, moduleId, approveId, analysisId, apiUser, demo}) {
  let user = await Meteor.userAsync();
  if(!user){
    user = apiUser
  }
  const companyId = user.profile.companyId;
  let description = '';
  let release = '';
  let data = await Meteor.callAsync('getProjectSBOM',projectId, companyId, moduleId, approveId)
  let { list, tree, cryptoProperties} = data
  let componentsCount = list.length;
  let completedActivity = 0;
  _.each(list, function (component) {
    if (component.completed) {
      completedActivity = completedActivity + 1
    }
  });
  const totalActivity = (componentsCount || 0) ;
  let doc = {
    created: new Date(),
    version: '1.0.0',
    companyId: companyId,
    projectId: projectId,
    moduleId: moduleId,
    analysisId,
    userId: user._id,
    userName: ((user.profile && user.profile.name)
    || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
    components: componentsCount,
    completed: completedActivity && totalActivity ? Math.round((completedActivity/totalActivity) * 100) : 0,
    totalActivity: totalActivity,
    completedActivity: completedActivity,
    disabled: false,
    description: description,
    release: release,
    list,
    tree,
    cryptoProperties,
    approveId,
    demo
  };
  const sbomFileId = await SbomFiles.insertAsync(doc);
  await writeApprovalStats('sbom', doc);
  return sbomFileId;
};

export default create;
