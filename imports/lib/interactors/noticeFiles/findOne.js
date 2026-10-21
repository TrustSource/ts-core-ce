import {Meteor} from 'meteor/meteor';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import {readJson} from '/imports/server/storage/fileStorage';
import {NOTICE_FILES_FOLDER} from '/imports/server/storage/storagePaths';

const findOne = async function (noticeId) {
  const user = await Meteor.userAsync();
  const companyId = user.profile.companyId;
  let data = await NoticeFiles.findOneAsync({_id:noticeId, companyId})
  if(data && data.fileUrl){
    try {
      const fileData = await readJson({companyId, folder: NOTICE_FILES_FOLDER, name: data.fileUrl.split('/').pop()});
      if (fileData) {
        data.licenses = fileData.licenses;
        data.unknownLicenseComponents = fileData.unknownLicenseComponents;
        data.writtenOffer = fileData.writtenOffer || data.writtenOffer;
      }
    }catch (e) {
      console.log(e)
    }
  }
  return data;
};

export default findOne;
