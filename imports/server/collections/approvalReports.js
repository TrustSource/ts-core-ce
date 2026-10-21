import {Meteor} from 'meteor/meteor';
import Utils from '/imports/server/ServerUtils';
import ApprovalReports from '/imports/lib/collections/approvalReports';

Meteor.publish('approvalReportDetail', async function (approveId, type) {
  if (typeof approveId !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return this.ready();
  }
  return ApprovalReports.find({approveId, type, companyId});
});

// Written only by server code; no client code writes this collection directly.
ApprovalReports.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawApprovalReports;

Meteor.startup(function () {
  RawApprovalReports = Utils.makeRawCollection(ApprovalReports);
  RawApprovalReports.createIndex('companyId');
  RawApprovalReports.createIndex('approveId');
  RawApprovalReports.createIndex('type');
  RawApprovalReports.createIndex('created');
});
