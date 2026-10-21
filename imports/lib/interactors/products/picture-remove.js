import {check} from 'meteor/check';
import updateProduct from './update';
import {authorizeProductFileChange} from './productAccess';
import {removeProductFile} from '/imports/server/storage/productFiles';
import {parseProductFileUrl, productFileUrl} from '/imports/server/storage/storagePaths';

const pictureRemove = async function (props, apiUser) {
  const {user, product} = await authorizeProductFileChange(props && props.product, apiUser, {identifier: 1});
  check(props.file.url, String);
  const companyId = user.profile.companyId
  // A URL that is not one of the caller's product files answers 400, as for documents.
  await removeProductFile({companyId, url: props.file.url})
  // Photos are stored with the relative URL; an API caller may send the absolute one.
  const parsed = parseProductFileUrl(props.file.url)
  const modifier = {
    $pull: {
      'documents.photos': {url: productFileUrl(parsed.companyId, parsed.name)}
    }
  }
  return await updateProduct(modifier, product._id, user);
};

export default pictureRemove;
