import {check} from 'meteor/check';
import Utils from '/imports/lib/utils';
import updateProduct from './update';
import {authorizeProductFileChange} from './productAccess';
import {storeProductFile, removeProductFileIfOwned} from '/imports/server/storage/productFiles';

const documentUpload = async function (props, apiUser) {
  const {user, product} = await authorizeProductFileChange(props && props.product, apiUser,
    {identifier: 1, documents: 1});
  check(props.file, Object);
  const companyId = user.profile.companyId
  let {fileExtension, data, fileName} = props.file
  const url = await storeProductFile({companyId, extension: fileExtension, data})
  if(product.documents && product.documents[props.file.documentType]){
    await removeProductFileIfOwned({companyId, url: product.documents[props.file.documentType].url})
  }
  const modifier = {
    $set: {
      [`documents.${props.file.documentType}`]: {
        url,
        name: fileName,
        uploaded: new Date(),
        uploadedBy: user._id,
        uploadedByName: Utils.username(user)
      }
    }
  }
  return await updateProduct(modifier, product._id, user);
};

export default documentUpload;
