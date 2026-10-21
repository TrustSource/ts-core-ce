import {Meteor} from 'meteor/meteor';
import updateProduct from './update';
import uuid from 'uuid';
import Products from '/imports/lib/collections/products';

const supportCreate = async function (props, apiUser) {
  let user = await Meteor.userAsync();
  if(!user){
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }
  if(!props.product._id && props.product.identifier){
    props.product = await Products.findOneAsync({identifier: props.product.identifier, companyId: user.profile.companyId},
      {fields:{identifier: 1}})
  }
  const support = props.support
  support._id = uuid.v4();
  support.created = new Date();
  const modifier = {
    $addToSet: {
      supportContracts: support
    }
  }
  return await updateProduct(modifier, props.product._id, user);
};

export default supportCreate;
