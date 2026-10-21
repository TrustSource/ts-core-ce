import {Meteor} from 'meteor/meteor';
import QualityProperties from '/imports/lib/collections/qualityProperties';

const remove = async function (_id) {
  const user = await Meteor.userAsync();
  if (!user) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Scope the delete to the caller's company and require a scalar id so a
  // selector object can't match/delete another tenant's records.
  const companyId = user.profile && user.profile.companyId;
  if (!companyId || typeof _id !== 'string') {
    throw new Meteor.Error(companyId ? 400 : 403, companyId ? 'Invalid id' : 'Access Denied');
  }
  const docId = await QualityProperties.removeAsync({_id, companyId});
  if(docId){
    await Meteor.callAsync('logEvent', user, 'Quality properties removed', 'qualityPropertiesRemove');
  }
  return docId
};

export default remove;
