import {Meteor} from 'meteor/meteor';
import CryptoProperties from '/imports/lib/collections/cryptoProperties';

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
  const docId = await CryptoProperties.removeAsync({_id, companyId});
  if(docId){
    await Meteor.callAsync('logEvent', user, 'Crypto properties removed', 'cryptoPropertiesRemove');
  }
  return docId
};

export default remove;
