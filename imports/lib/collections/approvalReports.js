import {Mongo} from 'meteor/mongo';
import ApprovalReport from '/imports/lib/project/ApprovalReport';
import {ApprovalReportSchema} from '/imports/lib/schemas/approvalReportSchema';

const ApprovalReports = new Mongo.Collection('approvalReports', {
  transform: function (doc) {
    return new ApprovalReport(doc);
  }
});

ApprovalReports.attachSchema(ApprovalReportSchema);

export default ApprovalReports;
