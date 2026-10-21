import {Meteor} from 'meteor/meteor';
import Messages from '/imports/lib/collections/messages';

const find = async function ({projectId, moduleId, componentKey, type}) {
  // Scope to the caller's company so a foreign project/module id can't reveal
  // another tenant's messages.
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if(companyId && projectId && moduleId && componentKey && type){
    return await Messages.find({companyId, projectId, moduleId, componentKey, type}).fetchAsync();
  }
  return [];
};

export default find;
