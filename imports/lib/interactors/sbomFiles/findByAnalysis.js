import {Meteor} from 'meteor/meteor';
import SbomFiles from '/imports/lib/collections/sbomFiles';

const findByAnalysis = async function (analysisId) {
  const user = await Meteor.userAsync();
  return analysisId ? await SbomFiles.findOneAsync({analysisId, companyId: user.profile.companyId},
    {fields: {analysisId : 1}, sort: {created: -1}}) : null;
};

export default findByAnalysis;
