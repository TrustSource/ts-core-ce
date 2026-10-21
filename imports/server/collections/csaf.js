import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import CSAF from '/imports/lib/collections/csaf';
import Companies from '/imports/lib/collections/companies';
import {CSAF_CREATE_ROLES} from '/imports/lib/interactors/csaf/create';
import {extractTlp} from '/imports/lib/csaf/feedAccess';
import Utils from '../ServerUtils';
import {asString} from '/imports/lib/security/sanitizeQuery';

Meteor.publish('csaf', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if(user && user.profile && user.profile.companyId){
    const companyId = user.profile.companyId
    return CSAF.find({companyId}, {fields:{data:0}});
  }
  this.ready();
});

Meteor.publish('csafDetail', async function (_id) {
  // Require a scalar _id: a {$ne:null} operator here dumps every company doc
  // including the `data` field that the list publication deliberately hides.
  const id = asString(_id);
  if (!id) {
    return this.ready();
  }
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    const companyId = user.profile.companyId
    return CSAF.find({companyId, _id: id});
  }
  this.ready();
});

// The CSAF import modal runs csaf/create.js in the browser, which inserts a DRAFT. That
// insert is all the client may do: status changes, publishing and removal go through
// server methods. The draft must carry exactly the fields create.js writes, its own
// company's provider id (ts-csaf.js counts advisory numbers per provider) and the TLP
// label of the document it holds (the public feed filters on it).
const CSAF_CLIENT_FIELDS = ['_id', 'submitted', 'companyId', 'providerId', 'data', 'name', 'category', 'tlp',
  'status'];

CSAF.allow({
  insert: async function (userId, doc) {
    const user = userId && await Meteor.users.findOneAsync(userId);
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId || !doc || doc.companyId !== companyId || doc.status !== 'DRAFT') {
      return false;
    }
    if (Object.keys(doc).some((field) => CSAF_CLIENT_FIELDS.indexOf(field) === -1)) {
      return false;
    }
    if (typeof doc.data !== 'string' || doc.tlp !== extractTlp(doc.data)) {
      return false;
    }
    if (!await Roles.userIsInRole(userId, CSAF_CREATE_ROLES, companyId)) {
      return false;
    }
    const company = await Companies.findOneAsync(companyId, {fields: {providerId: 1}});
    return doc.providerId === ((company && company.providerId) || companyId);
  }
});

export let RawCSAF;

Meteor.startup(function () {
  RawCSAF = Utils.makeRawCollection(CSAF);
  RawCSAF.createIndex('submitted');
  RawCSAF.createIndex('companyId');
  RawCSAF.createIndex('status');
});


