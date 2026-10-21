import {Meteor} from 'meteor/meteor';
import {CSAFCreate, CSAFRemove, CSAFValidate, CSAFUpdate, CSAFCreateOrUpdate, CSAFFindOne} from '/imports/lib/interactors/csaf';
import {encodeIdMap, decodeProductId} from '/imports/server/csaf/productId';
import {filterOwnedIds} from '/imports/server/csaf/ownership';
import {encodeModuleIds, decodeProductIds} from '/imports/server/csaf/productIdMethods';

// The collaborators the two pure product_id handlers run against. `error` builds a
// real Meteor.Error: a plain Error thrown out of a method reaches the DDP client as
// a bare 500, which would collapse every 400/403 in the method contract into one code.
const productIdDeps = {
  encodeIdMap,
  decodeProductId,
  filterOwnedIds,
  error: (code, reason) => new Meteor.Error(code, reason)
};

// Never taken from an argument - a client-supplied companyId is exactly the
// cross-tenant hole these methods exist to avoid.
async function callerCompanyId() {
  const user = await Meteor.userAsync();
  return user && user.profile && user.profile.companyId;
}

// CSAF.EncodeModuleIds / CSAF.DecodeProductIds are tenant-scoped and stay
// behind the DDP authentication gate (absent from PUBLIC_METHODS).
Meteor.methods({
  'CSAF.Create': CSAFCreate,
  'CSAF.Remove': CSAFRemove,
  'CSAF.Validate': CSAFValidate,
  'CSAF.Update': CSAFUpdate,
  'CSAF.CreateOrUpdate': CSAFCreateOrUpdate,
  'CSAF.FindOne': async function (...args) { return await CSAFFindOne.apply(this, args); },
  'CSAF.EncodeModuleIds': async function (ids) {
    return await encodeModuleIds(productIdDeps, ids, await callerCompanyId());
  },
  'CSAF.DecodeProductIds': async function (tokens) {
    return await decodeProductIds(productIdDeps, tokens, await callerCompanyId());
  }
});
