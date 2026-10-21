import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Products from '/imports/lib/collections/products';

// Roles that may change a product.
export const PRODUCT_WRITE_ROLES = ['developer', 'compliance_manager', 'company_security_manager',
  'account_admin'];

// The user a product write acts as: the logged-in DDP user, who must hold a product write
// role in their company, or, on a server call without a session (the REST layer), the API
// user that call resolved from its key.
export async function resolveProductWriter(apiUser) {
  const user = await Meteor.userAsync();
  if (!user) {
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return apiUser;
  }
  const companyId = user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user._id, PRODUCT_WRITE_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  return user;
}

function productFilter(productRef, companyId) {
  const ref = productRef && typeof productRef === 'object' ? productRef : {};
  const filter = {companyId};
  for (const key of ['_id', 'identifier']) {
    const value = ref[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (typeof value !== 'string') {
      throw new Meteor.Error(400, `Product ${key} must be a string`);
    }
    filter[key] = value;
  }
  if (!filter._id && !filter.identifier) {
    throw new Meteor.Error(400, 'Product _id or identifier is required');
  }
  return filter;
}

// Authorize a product file upload or removal and find its product in the caller's company.
// Runs before any file is stored or removed: a file written for a write that is then refused,
// or for a product that does not exist, would be left behind on the shared volume.
export async function authorizeProductFileChange(productRef, apiUser, fields) {
  const user = await resolveProductWriter(apiUser);
  const companyId = user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const product = await Products.findOneAsync(productFilter(productRef, companyId), {fields});
  if (!product) {
    throw new Meteor.Error(404, 'Product not found');
  }
  return {user, product};
}
