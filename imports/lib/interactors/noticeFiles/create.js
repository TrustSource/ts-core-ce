import _ from 'underscore';
import {Meteor} from 'meteor/meteor';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import Companies from '/imports/lib/collections/companies';
import Approves from '/imports/lib/collections/approves';
import NoticeFilesMapLicenses from './mapLicenses';
import {putFile} from '/imports/server/storage/fileStorage';
import {NOTICE_FILES_FOLDER} from '/imports/server/storage/storagePaths';
import {writeApprovalStats} from '/imports/server/approvalStats';

const NO_LICENSE = 'NO-LICENSE'

function getRelease(model) {
  if(model.getReleases().length > 0){
    let releases = _.sortBy(model.getReleases(), 'date').reverse();
    return releases[0].name
  }
  return null
}

const defaultWrittenOffer = {
  title: 'Open Source Announcement',
  description: [
    'The software included in this product contains copyrighted software that is licensed under the GPL/LGPL.',
    '',
    'You may obtain the complete corresponding source code from us for a period of three years after our last shipment ' +
    'of this product. If you want to obtain the complete corresponding source code on a physical medium such as CD-ROM, ' +
    'the cost of physically performing source distribution may be charged, please include the shipping address to ' +
    'determine costs of delivery. This offer is valid to anyone in receipt of this information. You express such ' +
    'wish by sending an email to // a request by using the following form:',
    '',
    'some-alias@your-company.com //',
    'https://somewebsite-with-a-contact-form.your-comany.com'
  ].join('\n')
};

 
const create = async function ({projectId, moduleId, approveId, analysisId, apiUser, binaryLinks, demo}) {
  let user = await Meteor.userAsync();
  if(!user){
    user = apiUser
  }
  const companyId = user.profile.companyId;
  let licenses = [];
  let unknownLicenseComponents = [];
  let description = '';
  let stats = {};
  let release = '';
  let module = {};
  let approve = approveId ? await Approves.findOneAsync(approveId): null;
  if(moduleId){
    module = await Modules.findOneAsync(moduleId);
    const approveAnalysis = approve ? approve.getModuleAnalysis(module._id) : null;
    analysisId = analysisId ? analysisId : approveAnalysis;
    let analysis = await module.getAnalysisAsync(null, analysisId);
    if(!analysisId && analysis){
      analysisId = analysis._id
    }
    const filter = analysis && analysis._id || null;
    licenses = analysis && (analysis.licenses || (analysis.getLicenses && analysis.getLicenses()) || []);
    _.each(licenses,function (license) {
      if(license.key === NO_LICENSE || license.key === 'NOASSERTION' || license.key === 'unknown'){
        unknownLicenseComponents.push(license);
      }
    });
    licenses = _.filter(licenses,function (license) {
      return license.key !== 'COMMERCIAL' && license.key !== NO_LICENSE && license.key !== 'NOASSERTION' && license.key !== 'unknown'
    });
    description = module.description;
    stats = module.getStatistics(filter);
    release = getRelease(module);
  }else if(projectId){
    let listFilter = {projectId:projectId};
    if(approve){
      listFilter._id = { $in : approve.getModuleIds()}
    }
    const modules = await Modules.find(listFilter).fetchAsync();
    const project = await Projects.findOneAsync(projectId);
    for (const module of modules) {
      let analysisId = approve ? approve.getModuleAnalysis(module._id) : null;
      let analysis = await module.getAnalysisAsync(null, analysisId);
      if (!analysis) continue;
      const filter = analysis._id || null;
      const statistic = module.getStatistics(filter);
      stats.components = (stats.components || 0) + statistic.components;
      let licensesList = analysis.licenses || (analysis.getLicenses && analysis.getLicenses()) || [];
      licensesList = _.map(licensesList, function (license) {
        license.moduleId = module._id;
        return license
      });
      licenses.push(licensesList);
    }
    licenses = _.flatten(_.filter(licenses,function (license) {
      return !!license
    }));
    _.each(licenses,function (license) {
      if(license.key === NO_LICENSE || license.key === 'NOASSERTION' || license.key === 'unknown'){
        unknownLicenseComponents.push(license);
      }
    });
    licenses = _.filter(licenses,function (license) {
      return license.key !== 'COMMERCIAL' && license.key !== NO_LICENSE && license.key !== 'NOASSERTION' && license.key !== 'unknown'
    });
    licenses = _.map(Object.values(_.groupBy(licenses,function (license) {
      return license.key
    })),function (licenses) {
      let components = _.flatten(_.map(licenses, function (license) {
        return license.components
      }));
      let newLicense = licenses[0];
      newLicense.moduleIds = _.map(licenses, function (license) {
        return license.moduleId
      });
      newLicense.components = components;
      return newLicense
    });
    description = project.description;
    release = getRelease(project);
  }

  // TODO module here should be also available for project calculations
  licenses = await NoticeFilesMapLicenses(licenses, module, companyId);
  let writtenOffer = false;
  if(_.some(licenses, function (license) {
    return license.writtenOffer
  })){
    writtenOffer = true;
  }
  let componentsCount = 0;
  let obligationsCount = 0;
  let completedActivity = 0;
  _.each(licenses, function (license) {
    componentsCount = componentsCount + license.components.length;
    obligationsCount = obligationsCount + license.obligations;
    if (license.completed) {
      completedActivity = completedActivity + 1
    }
    _.each(license.components, function (component) {
      if(component.completed) {
        completedActivity = completedActivity + 1
      }
    });
  });
  const totalActivity = (componentsCount || 0) + (licenses.length || 0);
  const company = await Companies.findOneAsync(companyId);
  unknownLicenseComponents = _.map(Object.values(_.groupBy(unknownLicenseComponents,function (license) {
    return license.key
  })),function (licenses) {
    return _.flatten(_.map(licenses, function (license) {
      return license.components
    }));
  })[0];
  let doc = {
    created: new Date(),
    version: '1.0.0',
    companyId: companyId,
    projectId: projectId,
    moduleId: moduleId,
    analysisId,
    userId: user._id,
    userName: ((user.profile && user.profile.name)
    || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
    components: stats.components,
    obligations: obligationsCount,
    completed: completedActivity && totalActivity ? Math.round((completedActivity/totalActivity) * 100) : 0,
    totalActivity: totalActivity,
    completedActivity: completedActivity,
    disabled: false,
    description: description,
    release: release,
    licenses: licenses,
    writtenOfferEnabled: writtenOffer,
    writtenOffer: company.writtenOffer || defaultWrittenOffer,
    unknownLicenseComponents,
    approveId,
    binaryLinks,
    demo
  };
  try {
    const name = `${doc.created.getTime()}.json`;
    await putFile({companyId: doc.companyId, folder: NOTICE_FILES_FOLDER, name, data: JSON.stringify(doc)});
    doc.fileUrl = `${doc.companyId}/${NOTICE_FILES_FOLDER}/${name}`;
    delete doc.licenses
  }catch (e) {
    console.log(e);
  }
  const noticeFileId = await NoticeFiles.insertAsync(doc);
  // The approval's key figures (Overview tab, Notice % column).
  await writeApprovalStats('notice', doc);
  return noticeFileId;
};

export default create;
