import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {moment} from 'meteor/momentjs:moment';
import _ from 'underscore';
import Policy from '/imports/lib/collections/policy';
import policyFiles from '/imports/lib/collections/policyFiles';
import Utils from '/imports/server/ServerUtils';
import {stripOperators} from '/imports/lib/security/sanitizeQuery';

// Operators the policy detail form legitimately produces. Anything else in a client-supplied
// modifier is dropped rather than forwarded to Mongo.
const ALLOWED_MODIFIER_OPERATORS = ['$set', '$unset'];

// `policy.file` is the _id of a policyFiles document and is used as a selector value by the
// policyFiles publication. The Policy collection has no attached schema, so a client is free
// to store an object there; {$gt: ''} would turn that lookup into an operator expression and
// publish every tenant's policy files. Reject a non-string reference at every write gate.
function isValidFileRef(value) {
  return typeof value === 'string' && value.length > 0;
}

function setsInvalidFileRef(modifier) {
  const set = modifier && modifier.$set;
  return !!(set && Object.prototype.hasOwnProperty.call(set, 'file') && !isValidFileRef(set.file));
}

function modifierSetsFile(modifier) {
  return !!(modifier && modifier.$set && Object.prototype.hasOwnProperty.call(modifier.$set, 'file'));
}

// A policyFiles document carries no companyId of its own; a file "belongs" to a company only
// because that company's policy references it - the same predicate the download `protected()`
// hook uses. That is exactly what let a compliance_manager reference ANOTHER tenant's file _id
// from their own policy and then read the PDF back through `protected()` (which would then find
// their own forged policy and allow the download). Type-checking `file` as a string closed the
// operator-injection hole but not this one: a plain string can still be a foreign file's _id.
//
// Enforce real ownership at every write gate. A file is referenceable by company `companyId` iff:
//   - it exists, and
//   - no OTHER company's policy already references it (it is not already claimed), and
//   - either this company already references it (an edit / re-use of a file we own) OR it was
//     uploaded by a member of this company (the first, legitimate claim on a fresh upload).
// The uploader clause is what stops referencing a victim's just-uploaded file before their own
// policy insert lands; the "already claimed" clause stops grabbing one that is already in use.
async function fileBelongsToCompany(fileId, companyId) {
  if (!isValidFileRef(fileId) || !companyId) { return false; }
  const file = await policyFiles.collection.findOneAsync(fileId, {fields: {userId: 1}});
  if (!file) { return false; }
  const claimedElsewhere = await Policy.findOneAsync(
    {file: fileId, companyId: {$ne: companyId}}, {fields: {_id: 1}});
  if (claimedElsewhere) { return false; }
  const alreadyOurs = await Policy.findOneAsync({file: fileId, companyId}, {fields: {_id: 1}});
  if (alreadyOurs) { return true; }
  if (!file.userId) { return false; }
  const uploader = await Meteor.users.findOneAsync(file.userId, {fields: {'profile.companyId': 1}});
  return !!(uploader && uploader.profile && uploader.profile.companyId === companyId);
}

// The modifier arrives straight from the client (AutoForm method-update). Keep only the
// operators above and strip $-prefixed keys out of their payloads, so a value can never smuggle
// a query operator into the update (project rule: never hand a user-supplied object to Mongo).
function sanitizePolicyModifier(modifier) {
  const clean = {};
  if (modifier && typeof modifier === 'object') {
    ALLOWED_MODIFIER_OPERATORS.forEach(function (operator) {
      const payload = modifier[operator];
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        clean[operator] = stripOperators(payload);
      }
    });
  }
  if (!clean.$set) { clean.$set = {}; }
  return clean;
}

Meteor.publish('policyList', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile.companyId && this.userId && await Roles.userIsInRole(this.userId, ['compliance_manager'], user.profile.companyId)) {
    return Policy.find({companyId:user.profile.companyId})
  }
  this.ready();
});

Meteor.publish('policyDetail', async function (policyId) {
  if (typeof policyId !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile.companyId && this.userId && await Roles.userIsInRole(this.userId, ['compliance_manager'], user.profile.companyId)) {
    return Policy.find({_id:policyId, companyId:user.profile.companyId});
  }
  this.ready();
});

Meteor.publish('policyForCompany', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if(user && user.profile && user.profile.companyId){
    return Policy.find({companyId:user.profile.companyId,active:true},{sort: {updatedDate: -1}, limit: 1});
  }
  this.ready();
});

function ifOnlyNotifiedEdited(fieldNames, modifier) {
  return fieldNames.length === 1 && fieldNames[0] === 'notified'
    && _.size(modifier) === 1 && modifier.$set
}

// The policy create page inserts directly. Every other policy write goes through a method
// (_updatePolicy, Policy.UpdateNotified, Policy.Remove), so there is no remove arm, and the
// update arm only ever accepts a member of the policy's own company. A policy never moves
// to another company.
Policy.allow({
  insert: async function (userId, doc) {
    const user = userId && await Meteor.users.findOneAsync(userId);
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId || !doc) { return false; }
    if (!isValidFileRef(doc.file)) { return false; }
    if (!await fileBelongsToCompany(doc.file, companyId)) { return false; }
    return !!(await Roles.userIsInRole(userId, ['compliance_manager'], companyId) && (companyId === doc.companyId))
  },
  update: async function (userId, doc, fieldNames, modifier) {
    const user = userId && await Meteor.users.findOneAsync(userId);
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId || companyId !== doc.companyId) { return false; }
    if (fieldNames.indexOf('companyId') > -1 || fieldNames.indexOf('_id') > -1) { return false; }
    if (setsInvalidFileRef(modifier)) { return false; }
    if (modifierSetsFile(modifier) && !await fileBelongsToCompany(modifier.$set.file, companyId)) { return false; }
    return !!ifOnlyNotifiedEdited(fieldNames, modifier) ||
      !!await Roles.userIsInRole(userId, ['compliance_manager'], companyId)
  }
});

Meteor.methods({
  _updatePolicy: async function (doc) {
    // AutoForm v8 method-update sends {_id, modifier} as single object
    const id = doc._id;
    const modifier = sanitizePolicyModifier(doc.modifier);
    if (setsInvalidFileRef(modifier)) {
      throw new Meteor.Error(400, 'Invalid policy file reference');
    }
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], companyId)) {
      throw new Meteor.Error(403, 'Access Denied - role check');
    }
    if (!id) {
      throw new Meteor.Error(400, 'Missing policy ID');
    }
    let currentDoc = await Policy.findOneAsync({_id: id, companyId},{fields:{active:1,companyId:1}});
    if(!currentDoc){
      throw new Meteor.Error(403, 'Access Denied - doc not found');
    }
    if (modifierSetsFile(modifier) && !await fileBelongsToCompany(modifier.$set.file, companyId)) {
      throw new Meteor.Error(403, 'Invalid policy file reference');
    }
    if (!currentDoc.active && modifier.$set.active){
      modifier.$set.activeFromDate = new Date();
    }else if (currentDoc.active && !modifier.$set.active){
      if (!modifier.$unset) modifier.$unset = {};
      modifier.$unset.activeFromDate = '';
    }
    modifier.$set.updatedDate = new Date();
    const data = await Policy.updateAsync({_id: id, companyId}, modifier);
    if (data !== 1) {
      let textError = 'Error: policy ' + modifier.$set.name + ' not deleted: ';
      await Meteor.callAsync('logEvent', user, textError, 'policyUpdated');
    } else {
      if(modifier.$set.active){
        await Policy.updateAsync({_id:{$ne: id},active:true,companyId:currentDoc.companyId}, {$set:{active:false}});
      }
      await Meteor.callAsync('logEvent', user, 'Policy '+modifier.$set.name+' has been updated', 'policyUpdated');
    }
    return data;
  },
  getLastPolicyUpdates: async function () {
    const user = await Meteor.userAsync();
    if(user){
      const companyId = user.profile.companyId;
      const policy = await Policy.findOneAsync({companyId, active:true},{sort: {updatedDate: -1}, limit: 1});
      if(policy){
        const isAlreadyNotifiedOrView = _.find(policy.notified,function (userItem) {
          return userItem.userId === user._id && (userItem.confirmedDate || (userItem.presentedDate &&
            (moment(userItem.presentedDate).unix() + 43200 > moment().unix()))) // do not show in 12h from last popup
        });
        if (!isAlreadyNotifiedOrView && await Roles.userIsInRole(user, policy.notify, companyId)){
          return policy
        }
      }
    }
  }
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawPolicy;

Meteor.startup(function () {
  RawPolicy = Utils.makeRawCollection(Policy);
  RawPolicy.createIndex('companyId');
});
