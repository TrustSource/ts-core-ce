import {Meteor} from 'meteor/meteor';
import Products from '/imports/lib/collections/products';
import Companies from '/imports/lib/collections/companies';
import {resolveActingUser} from '/imports/server/security/actingUser';

const create = async function ({demo, draft, type, identifier, name, description, properties, parentId, apiUser}, callback) {
  const submitted = new Date();
  // companyId is derived from the authenticated principal: a client call acts as
  // the session user, so apiUser (trusted only from the REST layer or a nested
  // import) cannot name another company.
  const user = await resolveActingUser(this, apiUser);
  const companyIdentifier = user && user.profile && user.profile.companyId;
  if (!companyIdentifier) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // Scope the uniqueness check to the company so it can't probe other tenants.
  if (await Products.findOneAsync({identifier, companyId: companyIdentifier})) {
    throw new Meteor.Error(400, `Product with same identifier already exists: ${identifier}`);
  }
  if(name){
    const company = await Companies.findOneAsync(companyIdentifier, {fields: {psirt: 1}});
    const product = {
      demo,
      draft,
      submitted,
      companyId: companyIdentifier,
      type,
      identifier,
      name,
      description,
      properties,
      parentId,
      contacts: company.psirt || {}
    };
    const newId = await Products.insertAsync(product);
    await Meteor.callAsync('logEvent', user, newId, 'productCreated');
    if(callback){
      callback(newId)
    }
    return newId
  }else {
    throw new Meteor.Error(400, 'Product name is required');
  }
};

export default create;
