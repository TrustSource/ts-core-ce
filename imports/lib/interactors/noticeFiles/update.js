import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import createChangesList from '../componentModifications/createChangesList';
import {putFile, readJson} from '/imports/server/storage/fileStorage';
import {NOTICE_FILES_FOLDER} from '/imports/server/storage/storagePaths';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';
import {writeApprovalStats} from '/imports/server/approvalStats';

const update = async function (modifier, _id, filter, componentUpdates, fullData) {
  const user = await Meteor.userAsync();
  const companyId = user.profile.companyId;
  if (!user || !await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  modifier = sanitizeModifier(modifier);
  if(!modifier['$set']){
    modifier['$set']= {};
  }
  modifier['$set'].edited = new Date();
  modifier['$set'].userId = user._id;
  modifier['$set'].userName = ((user.profile && user.profile.name)
  || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
  if(componentUpdates){
    try{
      createChangesList(componentUpdates);
    }catch (error){
      console.log('Error in createChangesList', error);
    }
  }
  const query = filter ? stripDangerousOperators(filter) : {_id};
  query.companyId = user.profile.companyId
  let listUpdates;
  let doc = await NoticeFiles.findOneAsync(_id, {fields:{fileUrl: 1,created: 1}})
  if(doc.fileUrl){
    listUpdates = modifier['$set']['licenses.$']
    delete modifier['$set']['licenses.$']
    delete query.licenses
  }
  const file = await NoticeFiles.updateAsync(query, modifier);
  if(file){
    try {
      if(doc.fileUrl){
        const ref = {companyId, folder: NOTICE_FILES_FOLDER, name: doc.fileUrl.split('/').pop()};
        // Start from what is stored, so fields this update does not carry
        // (unknownLicenseComponents, writtenOffer, ...) survive the rewrite.
        const stored = await readJson(ref) || {};
        let licenses = fullData ? fullData.licenses : stored.licenses;
        if(!fullData && listUpdates && listUpdates.key && Array.isArray(licenses)){
          licenses = licenses.map((license) => {
            return license.key === listUpdates.key ? listUpdates : license
          })
        }
        const next = Object.assign({}, stored, doc, {licenses});
        await putFile(Object.assign({data: JSON.stringify(next)}, ref));
      }
    }catch (e) {
      console.log(e);
    }
    // Completing activities changes the approval's figures.
    await writeApprovalStats('notice', await NoticeFiles.findOneAsync(query), Object.keys(modifier.$set || {}));
  }
  return file
};

export default update;
