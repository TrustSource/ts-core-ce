import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
//import NoticeFiles from '/imports/lib/collections/noticeFiles';
import NoticeFilesUpdate from './update';

// function incVersion(version) {
//   let versionList = version.split('.');
//   versionList[0] = parseInt(versionList[0])+1;
//   versionList[1] = 0;
//   versionList[2] = 0;
//   return versionList.join('.')
// }

const freeze = async function (_id) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  //let noticeFile = NoticeFiles.findOne(_id);
  const modifier = {
    '$set': {
      disabled: new Date()
    }
  };
  return await NoticeFilesUpdate(modifier, _id);
  // delete noticeFile._id;
  // noticeFile.created = new Date();
  // noticeFile.version = incVersion(noticeFile.version);
  // noticeFile.disabled = false;
  // noticeFile.userId = user._id;
  // noticeFile.userName = ((user.profile && user.profile.name)
  // || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
  // return NoticeFiles.insert(noticeFile, callback);
};

export default freeze;
