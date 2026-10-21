import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Utils from '/imports/lib/utils';
import ProductsUpdate from './update';

const remove = async function (_id, reason) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'company_security_manager', 'account_admin'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let modifier = {
    '$set': {
      retired: new Date(),
      retiredReason: reason,
      retiredBy: user._id,
      retiredByName: Utils.username(user)
    }
  }
  return await ProductsUpdate(modifier, _id, user);
};

export default remove;
