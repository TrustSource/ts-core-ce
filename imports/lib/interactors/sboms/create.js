import {Meteor} from 'meteor/meteor';
import SBOMs from '/imports/lib/collections/sboms';

const create = async function ({projectId, approveId, apiUser}) {
  let user = await Meteor.userAsync();
  if(!user){
    user = apiUser
  }
  const companyId = user.profile.companyId;
  const data = await Meteor.callAsync('getProjectSBOM', projectId, companyId, null, approveId)
  let doc = {
    created: new Date(),
    approveId,
    companyId: companyId,
    data
  };
  return await SBOMs.insertAsync(doc);
};

export default create;
