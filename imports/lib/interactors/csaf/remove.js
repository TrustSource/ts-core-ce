import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import CSAF from '/imports/lib/collections/csaf';
import _ from 'underscore';
import Utils from '/imports/lib/utils';
import Modules from '/imports/lib/collections/modules';
import {CSAFFindOne} from './index';
import {decodeProductId} from '/imports/server/csaf/productId';
import {filterOwnedModuleIds} from '/imports/server/csaf/ownership';

const remove = async function (_id, _filter, params) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'company_security_manager', 'account_admin'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (typeof _id !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  // One decoder for this whole removal, so the document below pays for each
  // DISTINCT product_id once and for no more than MAX_DECODED_PRODUCT_IDS of them.
  const decodeToken = productIdDecoder();
  const csaf = await CSAFFindOne(_id)
  if(!csaf){
    throw new Meteor.Error(404, 'CSAF document not found');
  }
  if(csaf.status === 'PUBLISHED' || csaf.published){
    throw new Meteor.Error(400, 'You may not remove PUBLISHED documents');
  }
  if(params && (params.unmuteVulnerabilities || params.openRisks)){
    const csafData = JSON.parse(csaf.data);
    if(csafData.document && csafData.document.category === 'csaf_vex'){
      const decodedCves = (csafData.vulnerabilities || []).map(cve => {
        return {
          cveKey: cve.cve,
          // A product_id that does not decode (a forged or corrupted token, or one
          // minted under a retired legacy secret) is DROPPED rather than passed on:
          // unmuteVulnerability and openRisk both write against whatever moduleId
          // they are handed.
          moduleIds: (cve.product_status
            ? Object.values(cve.product_status).flatMap(v => Array.isArray(v) ? v : [])
              .map(productId => decodeToken(productId))
              .filter(moduleId => typeof moduleId === 'string' && moduleId !== '')
            : [])
        }
      })
      // A product_id is attacker-controllable: an uploaded document can carry real
      // tokens taken from another company's published advisory, naming its module
      // ids. unmuteVulnerability writes
      // cveConfig.whitelist and analysisRequired on an UNSCOPED Modules lookup, and
      // openRisk stamps the caller's own companyId onto a risk pointing at an
      // arbitrary moduleId - so the decoded ids are scoped to the caller's company
      // first, in one query for the whole document.
      const ownedModuleIds = await filterOwnedModuleIds(
        [...new Set(decodedCves.flatMap(cve => cve.moduleIds))], user.profile.companyId)
      const listCves = decodedCves.map(cve => {
        return {
          cveKey: cve.cveKey,
          moduleIds: cve.moduleIds.filter(moduleId => ownedModuleIds.has(moduleId))
        }
      })
      if(listCves && listCves.length > 0){
        for (const cve of _.unique(listCves,'cveKey')) {
          let {cveKey, moduleIds} = cve
          for (const moduleId of moduleIds) {
            if(params.unmuteVulnerabilities){
              await unmuteVulnerability(cveKey, moduleId)
            }
            if(params.openRisks){
              await openRisk(user, cveKey, moduleId)
            }
          }
        }
      }
    }
  }
  await Meteor.callAsync('logEvent', user, `${_id} ${params ? 'with actions: ' + Object.keys(params || {})
    .filter(k => params[k] === true)
    .join('; '): ''}`, 'csafRemoved');
  return await CSAF.removeAsync({_id, companyId: user.profile.companyId});
};

// A CSAF document is JSON the caller uploaded (csaf-import-modal -> csaf/create.js)
// and neither create.js nor CSAFSchema caps its size, so the number of product_id
// strings in it is bounded only by what fits in a Mongo document - roughly 250,000
// at 64 bytes each. Decoding runs a cipher over every one of them.
//
// The cap is far above any real document: a VEX document covers the modules of one
// project, so its distinct product_ids number in the hundreds. Truncating is worse
// than the work it avoids (a skipped unmute is a silent wrong answer), so it is
// logged rather than swallowed.
const MAX_DECODED_PRODUCT_IDS = 10000;

/**
 * A decode function scoped to ONE document: each distinct product_id is decoded at
 * most once, and at most MAX_DECODED_PRODUCT_IDS of them are decoded at all.
 *
 * Deduping matters as much as the cap. A document repeating one token across 500
 * vulnerabilities used to pay for 500 decrypts of the same string, and the
 * likeliest abusive shape - tokens that never resolve - is why misses are cached
 * too rather than only successes.
 */
function productIdDecoder() {
  const decoded = new Map();
  let truncated = false;
  return function (productId) {
    if (decoded.has(productId)) {
      return decoded.get(productId);
    }
    if (decoded.size >= MAX_DECODED_PRODUCT_IDS) {
      if (!truncated) {
        truncated = true;
        console.warn(`[CSAF remove] more than ${MAX_DECODED_PRODUCT_IDS} distinct product_ids `
          + 'in one document; the remainder are not resolved');
      }
      return undefined;
    }
    const moduleId = decodeProductId(productId);
    decoded.set(productId, moduleId);
    return moduleId;
  };
}

async function unmuteVulnerability(cveKey, moduleId){
  const module = await Modules.findOneAsync(moduleId, {fields: {cveConfig: 1}})
  if(module){
    const arr = module.cveConfig && module.cveConfig.whitelist || [];
    const originalData = _.clone(arr);
    const filteredArr = _.reject(arr, function (e) {
      return e.cveKey === cveKey;
    });
    if (arr.length !== filteredArr.length) {
      await Meteor.callAsync('updateCollection', 'Modules', module._id, 'cveConfig.whitelist', filteredArr, true, originalData);
      await Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
    }
  }
}

async function openRisk(user, cveKey, moduleId){
  let risk = {
    moduleId: moduleId,
    name: cveKey,
    riskProperties: Utils.cleanObject({
      origin: ['CVE'],
      impactDescription: 'Opened risk after CSAF removed',
      state: 'identified'
    })
  }
  await Meteor.callAsync('RiskProperties.Create', risk, user);
}

export default remove;
