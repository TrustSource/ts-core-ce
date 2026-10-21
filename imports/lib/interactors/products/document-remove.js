import updateProduct from './update';
import {check} from 'meteor/check';
import {authorizeProductFileChange} from './productAccess';
import {removeProductFile} from '/imports/server/storage/productFiles';

const documentRemove = async function (props, apiUser) {
  const {user, product} = await authorizeProductFileChange(props && props.product, apiUser, {identifier: 1});
  check(props.file.url, String);
  check(props.documentType, String);
  const companyId = user.profile.companyId
  await removeProductFile({companyId, url: props.file.url})
  const modifier = {
    $unset: {
      [`documents.${props.documentType}`]: true
    }
  }
  return await updateProduct(modifier, product._id, user);
};

export default documentRemove;
