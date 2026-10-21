import {Meteor} from 'meteor/meteor';
import Utils from '/imports/lib/utils';
import updateProduct from './update';
import {authorizeProductFileChange} from './productAccess';
import Companies from '/imports/lib/collections/companies';
import SbomFiles from '/imports/lib/collections/sbomFiles';
import Approves from '/imports/lib/collections/approves';
import reportSbomFileService from '/imports/lib/reports/reportSbomFileService';
import mergeCycloneDX from '../../converter/merge-cydx';
import {storeProductFile, removeProductFileIfOwned} from '/imports/server/storage/productFiles';

const sbomGenerate = async function (props, apiUser) {
  const {user, product} = await authorizeProductFileChange(props && props.product, apiUser,
    {identifier: 1, documents: 1, solutions: 1, name: 1});
  const companyId = user.profile.companyId
  const company = await Companies.findOneAsync(companyId);
  const documentType = 'sbom'
  if(!product.solutions || !product.solutions.length){
    throw new Meteor.Error(400, 'No solutions selected for product');
  }
  let sbomFiles = []
  for (const solution of product.solutions) {
    const approval = await Approves.findOneAsync({_id:solution._id})
    if(approval && approval.sbomFileId){
      const sbomFile = await SbomFiles.findOneAsync({_id:approval.sbomFileId})
      if(sbomFile){
        sbomFile.company = company
        const cydx = reportSbomFileService.getCycloneDxDetails(sbomFile)
        sbomFiles.push(cydx)
      }
    }
  }
  const fileName = `cydx-sbom-${Date.now()}.json`
  const data = await mergeCycloneDX(sbomFiles)
  const url = await storeProductFile({companyId, extension: 'json', data: JSON.stringify(data)})
  if(product.documents && product.documents[documentType]){
    await removeProductFileIfOwned({companyId, url: product.documents[documentType].url})
  }
  const modifier = {
    $set: {
      [`documents.${documentType}`]: {
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

export default sbomGenerate;
