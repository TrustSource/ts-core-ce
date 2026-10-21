import {Roles} from 'meteor/alanning:roles';

// check that the userId specified owns the documents
export const ownsDocument = function (userId, doc) {
  return doc && doc.userId === userId;
};

export const managesCompany = function (userId, company) {
  return Roles.userIsInRole(userId, ['account_admin','manager','compliance_manager'], company._id);
};

