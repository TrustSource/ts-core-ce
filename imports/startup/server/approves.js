import {Meteor} from 'meteor/meteor';
import {
  ApprovesCreate, ApprovesUpdate, ApprovesApprove, ApprovesReject, ApprovesRemove,
  ApprovesCountApprovedProjectApproves, ApprovesCreateFromDraft, ApprovesBinaryLinkAdd,
  ApprovesBinaryLinkRemove, ApprovesMarkDocumentsAsReleased
} from '/imports/lib/interactors/approves'

Meteor.methods({
  'Approves.Create': ApprovesCreate,
  'Approves.Update': ApprovesUpdate,
  'Approves.Approve': ApprovesApprove,
  'Approves.Reject': ApprovesReject,
  'Approves.Remove': ApprovesRemove,
  'Approves.CountApprovedProjectApproves': ApprovesCountApprovedProjectApproves,
  'Approves.CreateFromDraft': ApprovesCreateFromDraft,
  'Approves.BinaryLinkAdd': ApprovesBinaryLinkAdd,
  'Approves.BinaryLinkRemove': ApprovesBinaryLinkRemove,
  'Approves.MarkDocumentsAsReleased': ApprovesMarkDocumentsAsReleased
});
