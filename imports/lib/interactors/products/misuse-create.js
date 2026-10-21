import {Meteor} from 'meteor/meteor';
import uuid from 'uuid';
import updateProduct from './update';
import Products from '/imports/lib/collections/products';

const misuseCreate = async function (props, apiUser) {
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
  const misuse = props.misuse
  misuse._id = uuid.v4();
  misuse.created = new Date();
  const modifier = {
    $addToSet: {
      misuses: misuse
    }
  }
  return await updateProduct(modifier, props.product._id, user);
};

export default misuseCreate;
