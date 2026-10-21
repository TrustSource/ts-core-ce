import {check} from 'meteor/check';
import Utils from '/imports/lib/utils';
import updateProduct from './update';
import {authorizeProductFileChange} from './productAccess';
import {storeProductFile} from '/imports/server/storage/productFiles';

const pictureUpload = async function (props, apiUser) {
  const {user, product} = await authorizeProductFileChange(props && props.product, apiUser, {identifier: 1});
  check(props.file, Object);
  const companyId = user.profile.companyId
  let {fileExtension, data, fileName} = props.file
  const url = await storeProductFile({companyId, extension: fileExtension, data})
  const modifier = {
    $addToSet: {
      'documents.photos': {
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

export default pictureUpload;
