import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules';
import Capabilities from '/imports/lib/collections/capabilities';
import {asString} from '/imports/lib/security/sanitizeQuery';

const findByProject = async function (params) {
  const user = await Meteor.userAsync();
  // Authenticated client calls are scoped to their own company; only trusted
  // server-side calls (no DDP user) may supply a companyId.
  const companyId = user ? (user.profile && user.profile.companyId) : params.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const projectId = asString(params.projectId);
  if(projectId){
    const modules = await Modules.find({companyId, projectId}).fetchAsync();
    const moduleIds = modules.map(function(module){
      return module._id;
    });
    return await Capabilities.find({companyId, moduleId: {$in: moduleIds}}).fetchAsync();
  }
};

export default findByProject;
