import {Mongo} from 'meteor/mongo';
import NoticeFile from '/imports/lib/company/NoticeFile';

const NoticeFiles = new Mongo.Collection('noticeFiles', {
  transform: function (doc) {
    return new NoticeFile(doc);
  }
});

export default NoticeFiles;
