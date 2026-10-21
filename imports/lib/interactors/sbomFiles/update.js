import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import SbomFiles from '/imports/lib/collections/sbomFiles';
import createChangesList from '../componentModifications/createChangesList';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';
import {writeApprovalStats} from '/imports/server/approvalStats';

const update = async function (modifier, _id, filter, componentUpdates) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  modifier = sanitizeModifier(modifier);
  if(!modifier['$set']){
    modifier['$set']= {};
  }
  modifier['$set'].edited = new Date();
  modifier['$set'].userId = user._id;
  modifier['$set'].userName = ((user.profile && user.profile.name)
  || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
  if(componentUpdates){
    try{
      createChangesList(componentUpdates);
    }catch (error){
      console.log('Error in createChangesList', error);
    }
  }
  const query = filter ? stripDangerousOperators(filter) : {_id};
  query.companyId = user.profile.companyId
  const updated = await SbomFiles.updateAsync(query, modifier);
  if (updated) {
    await writeApprovalStats('sbom', await SbomFiles.findOneAsync(query), Object.keys(modifier.$set || {}));
  }
  return updated;
};

export default update;
