import {Meteor} from 'meteor/meteor';
import Utils from '/imports/lib/utils';
import Products from '/imports/lib/collections/products';
import ProductsCreate from './create';
import {planProductImport} from './importPlan';
import {resolveActingUser} from '/imports/server/security/actingUser';

// Upper bound for the uploaded text, well above MAX_IMPORT_PRODUCTS rows.
const MAX_IMPORT_FILE_LENGTH = 5 * 1024 * 1024;
// How many problems the error message lists.
const MAX_LISTED_ERRORS = 10;

const importFile = async function ({file, parentId, apiUser, draft}, callback) {
  // companyId is derived from the authenticated principal: a client call acts as
  // the session user, so apiUser (trusted only from the REST layer) cannot name
  // another company.
  const user = await resolveActingUser(this, apiUser);
  const companyIdentifier = user && user.profile && user.profile.companyId;
  if (!companyIdentifier) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof file !== 'string' || file.length > MAX_IMPORT_FILE_LENGTH || !Utils.isJsonString(file)) {
    throw new Meteor.Error(400, 'Invalid file content. Please upload a products import (.json) file.');
  }
  if (parentId !== undefined && parentId !== null && typeof parentId !== 'string') {
    throw new Meteor.Error(400, 'Invalid parent');
  }
  // The whole file is checked before anything is written: an error in a later row
  // used to leave the earlier rows imported, and an unknown parent left a product
  // that the tree never shows.
  const existing = new Set((await Products.find({companyId: companyIdentifier},
    {fields: {identifier: 1}}).fetchAsync()).map((product) => product.identifier));
  const {errors, rows} = planProductImport(JSON.parse(file), existing, parentId || undefined);
  if (errors.length) {
    const more = errors.length > MAX_LISTED_ERRORS ? ` (and ${errors.length - MAX_LISTED_ERRORS} more)` : '';
    throw new Meteor.Error(400, `Nothing was imported: ${errors.slice(0, MAX_LISTED_ERRORS).join('; ')}${more}`);
  }
  const created = [];
  try {
    for (const row of rows) {
      created.push(await ProductsCreate({draft, ...row, companyId: companyIdentifier, apiUser: user}, false));
    }
  } catch (error) {
    // All or nothing: remove what this import already created.
    if (created.length) {
      await Products.removeAsync({_id: {$in: created}, companyId: companyIdentifier});
    }
    throw error;
  }
  if(callback){
    callback()
  }
  return created.length;
};

export default importFile;
