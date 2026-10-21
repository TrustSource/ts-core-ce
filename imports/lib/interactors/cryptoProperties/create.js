import {Meteor} from 'meteor/meteor';
import CryptoProperties from '/imports/lib/collections/cryptoProperties';
import Utils from '/imports/lib/utils';

const create = async function (params) {
  const user = await Meteor.userAsync();
  let doc = {
    created: new Date(),
    userId: user._id,
    userName: ((user.profile && user.profile.name)
      || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
    companyId: user.profile.companyId,
    projectId: params.projectId,
    moduleId: params.moduleId,
    name: params.name,
    comment: params.comment,
    used: params.used,
    origin: params.origin,
    assetType: params.assetType || 'algorithm',
    algorithmProperties: Utils.cleanObject(params.algorithmProperties || {}),
    certificateProperties: Utils.cleanObject(params.certificateProperties || {}),
    protocolProperties: Utils.cleanObject(params.protocolProperties || {}),
    relatedCryptoMaterialProperties: Utils.cleanObject(params.relatedCryptoMaterialProperties || {})
  };
  let result = await CryptoProperties.insertAsync(doc);
  if(result){
    await Meteor.callAsync('logEvent', user, 'Crypto properties ' + doc.name + ' created', 'cryptoPropertiesCreate');
  }
  return result
};

export default create;
