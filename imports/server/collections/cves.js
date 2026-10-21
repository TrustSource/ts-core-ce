import {Meteor} from 'meteor/meteor';
import Cves from '/imports/lib/collections/cves';
import Vulnerability from '/imports/lib/component/Vulnerability';
import OsvVulns from '/imports/lib/collections/osvVulns';
import Utils from '/imports/server/ServerUtils';

// Indexes of the OSV cache. Not awaited: Meteor binds the port only after every startup
// hook resolves, and an index build must not hold up /healthcheck.
Meteor.startup(function () {
  [
    Utils.makeRawCollection(Cves).createIndex({key: 1}),
    Utils.makeRawCollection(OsvVulns).createIndex({aliases: 1})
  ].forEach(function (building) {
    building.catch(function (error) {
      console.info('=> OSV cache index:', (error && error.message) || error);
    });
  });
});


Meteor.methods({
  'Cves.count': async function () {
    return await Cves.find().countAsync();
  },
  'Cves.byComponentVersion': async function (key, versionList, companyId) {
    // A DDP boundary with no in-repo caller, whose `key` used to be inert: the
    // synchronous join never reached Mongo on the server. It does now, and
    // `cves` is shared across every tenant, so an operator object here would
    // read the whole vulnerability lake. Validated BEFORE any work.
    if (typeof key !== 'string' || !key ||
      key.length > Vulnerability.COMPONENT_KEY_LOOKUP_MAX) {
      throw new Meteor.Error(400, 'Invalid arguments');
    }
    if (versionList !== undefined && versionList !== null) {
      if (!Array.isArray(versionList) ||
        versionList.length > Vulnerability.VERSIONS_PER_LOOKUP_MAX ||
        !versionList.every(function (version) { return typeof version === 'string'; })) {
        throw new Meteor.Error(400, 'Invalid arguments');
      }
    }
    // For client (DDP) calls, derive companyId from the authenticated user so a
    // caller cannot read another tenant's manual vulnerabilities by passing a
    // different companyId. Trusted server-internal calls (connection null) keep
    // the explicit companyId argument.
    if (this.connection) {
      const user = this.userId && await Meteor.users.findOneAsync(this.userId, {fields: {'profile.companyId': 1}});
      companyId = (user && user.profile && user.profile.companyId) || undefined;
    }
    // findAllAsync, not findAll: on a Meteor 3 server every cursor read is
    // async, so the synchronous helper returned [] to every DDP caller of this
    // method.
    return await Vulnerability.findAllAsync(key, versionList, companyId)
  }
});
