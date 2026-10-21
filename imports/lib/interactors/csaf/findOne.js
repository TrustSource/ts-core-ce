import {Meteor} from 'meteor/meteor';
import CSAF from '/imports/lib/collections/csaf';

const findOne = async function (_id) {
  // _id must be a plain string - never a query operator object, otherwise a
  // selector like {$gt:''} would return another tenant's advisory.
  if (typeof _id !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  return await CSAF.findOneAsync({_id, companyId});
};

export default findOne;
