import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Products from '/imports/lib/collections/products';

const removeDrafts = async function () {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['manager', 'compliance_manager',
    'company_security_manager', 'account_admin'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  return await Products.removeAsync({companyId: user.profile.companyId, draft: true});
};

export default removeDrafts;
