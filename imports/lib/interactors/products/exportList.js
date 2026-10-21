import Products from '/imports/lib/collections/products';
import {resolveActingUser} from '/imports/server/security/actingUser';

const exportList = async function ({apiUser} = {}, callback) {
  // companyId is derived from the authenticated principal: a client call acts as
  // the session user, so apiUser (trusted only from the REST layer) cannot name
  // another company.
  const user = await resolveActingUser(this, apiUser);
  const companyIdentifier = user && user.profile && user.profile.companyId;
  if(companyIdentifier){
    const list = await Products.find({companyId: companyIdentifier, retired: { $in: [null] }},{fields:{
      type: 1, identifier: 1, name: 1, description: 1, parentId: 1
    }}).fetchAsync();
    let products = []
    let relations = []
    for (const product of list) {
      products.push({
        type: product.type,
        identifier: product.identifier,
        name: product.name,
        description: product.description
      });
      if(product.parentId){
        let relation = relations.find(relation => relation.identifier === product.parentId);
        if(!relation){
          relations.push({
            identifier : product.parentId,
            contains: [
              product.identifier
            ]
          })
        }else{
          relation.contains.push(product.identifier);
        }
      }
    }
    let report = {
      format : 'TrustSourceProducts',
      version : 1,
      products,
      relations
    }
    if(callback){
      callback(report)
    }
    return report

  }else {
    throw new Meteor.Error(400, 'companyId is required');
  }
};

export default exportList;
