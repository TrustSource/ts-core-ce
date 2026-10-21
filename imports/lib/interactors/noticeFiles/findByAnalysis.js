import {Meteor} from 'meteor/meteor';
import NoticeFiles from '/imports/lib/collections/noticeFiles';

const findByAnalysis = async function (analysisId) {
  const user = await Meteor.userAsync();
  return analysisId ? await NoticeFiles.findOneAsync({analysisId, companyId: user.profile.companyId},
    {fields: {analysisId : 1}, sort: {created: -1}}) : null;
};

export default findByAnalysis;
