import {Meteor} from 'meteor/meteor';
import {
  NoticeFilesCreate, NoticeFilesUpdate, NoticeFilesFreeze,
  NoticeFilesBinaryLinkAdd, NoticeFilesBinaryLinkRemove, NoticeFilesFindByAnalysis, NoticeFilesFindOne,
  NoticeFilesRemove
} from '/imports/lib/interactors/noticeFiles'

Meteor.methods({
  'NoticeFiles.Create': NoticeFilesCreate,
  'NoticeFiles.Update': NoticeFilesUpdate,
  'NoticeFiles.Freeze': NoticeFilesFreeze,
  'NoticeFiles.BinaryLinkAdd': NoticeFilesBinaryLinkAdd,
  'NoticeFiles.BinaryLinkRemove': NoticeFilesBinaryLinkRemove,
  'NoticeFiles.FindByAnalysis': NoticeFilesFindByAnalysis,
  'NoticeFiles.FindOne': NoticeFilesFindOne,
  'NoticeFiles.Remove': NoticeFilesRemove
});
