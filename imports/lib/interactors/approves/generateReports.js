import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import ApprovesUpdate from './update';
import SaveReports from './saveReports';

function getModuleIds(approval) {
  return _.map(approval.modules,function (module) {
    return module._id
  });
}

const generateReports = async function (approval, approveId, user) {
  let stats = {}
  let {projectId, companyId, modules, demo} = approval
  const moduleIds = getModuleIds(approval)

  // The report stage (these 9 getProject* calls + the stats write) is the
  // first of the 4 generation stages. Mark it running here and done on success;
  // the caller (runApproveGeneration) records 'failed' if this throws.
  try {
    await ApprovesUpdate({$set: {
      'generation.current': 'report',
      'generation.stages.report': 'running'
    }}, approveId, false, user)
  } catch (e) { console.log('generation report stage running update error: ', e) }

  try {
    const data = await Meteor.callAsync('getProjectVulnerability', projectId, companyId, moduleIds, modules);
    if(data){
      stats.vulnerability = data.stats
      try {
        await SaveReports({approveId, companyId, type:'vulnerability', data, demo})
      }catch (e){
        console.log('getProjectVulnerability error: ', e)
      }
    }
  } catch (e) { console.log('getProjectVulnerability call error: ', e) }

  try {
    const data = await Meteor.callAsync('getProjectLicenses', projectId, companyId, moduleIds, modules);
    if(data){
      stats.licenses = data.stats
      try {
        await SaveReports({approveId, companyId, type:'licenses', data, demo})
      }catch (e){
        console.log('getProjectLicenses error: ', e)
      }
    }
  } catch (e) { console.log('getProjectLicenses call error: ', e) }

  try {
    const data = await Meteor.callAsync('getLicenseStatistics', projectId, moduleIds, modules);
    if(data){
      try {
        await SaveReports({approveId, companyId, type:'legal', data, demo})
      }catch (e){
        console.log('getLicenseStatistics error: ', e)
      }
    }
  } catch (e) { console.log('getLicenseStatistics call error: ', e) }

  try {
    const data = await Meteor.callAsync('getProjectVersioning', projectId, companyId, moduleIds, modules);
    if(data){
      stats.versioning = data.stats
      try {
        await SaveReports({approveId, companyId, type:'versioning', data, demo})
      }catch (e){
        console.log('getProjectVersioning error: ', e)
      }
    }
  } catch (e) { console.log('getProjectVersioning call error: ', e) }

  try {
    const data = await Meteor.callAsync('getProjectViability', projectId, companyId, moduleIds, modules);
    if(data){
      stats.viability = data.stats
      try {
        await SaveReports({approveId, companyId, type:'viability', data, demo})
      }catch (e){
        console.log('getProjectViability error: ', e)
      }
    }
  } catch (e) { console.log('getProjectViability call error: ', e) }

  try {
    const data = await Meteor.callAsync('getProjectModification', projectId, companyId, moduleIds, modules);
    if(data){
      stats.changes = data.stats
      try {
        await SaveReports({approveId, companyId, type:'changes', data, demo})
      }catch (e){
        console.log('getProjectModification error: ', e)
      }
    }
  } catch (e) { console.log('getProjectModification call error: ', e) }

  try {
    const data = await Meteor.callAsync('getProjectExportControl', projectId, companyId, moduleIds, modules);
    if(data){
      stats.export_control = data.stats
      try {
        await SaveReports({approveId, companyId, type:'export_control', data, demo})
      }catch (e){
        console.log('getProjectExportControl error: ', e)
      }
    }
  } catch (e) { console.log('getProjectExportControl call error: ', e) }

  try {
    const data = await Meteor.callAsync('getProjectTests', projectId, companyId, moduleIds, modules);
    if(data){
      stats.tests = data.stats
      try {
        await SaveReports({approveId, companyId, type:'tests', data, demo})
      }catch (e){
        console.log('getProjectTests error: ', e)
      }
    }
  } catch (e) { console.log('getProjectTests call error: ', e) }

  try {
    const data = await Meteor.callAsync('getProjectCapabilities', projectId, companyId, moduleIds, modules);
    if(data){
      stats.capabilities = data.stats
      try {
        await SaveReports({approveId, companyId, type:'capabilities', data, demo})
      }catch (e){
        console.log('getProjectCapabilities error: ', e)
      }
    }
  } catch (e) { console.log('getProjectCapabilities call error: ', e) }

  const result = await ApprovesUpdate({$set:{stats:stats}},approveId, false, user)
  // Report stage finished successfully.
  try {
    await ApprovesUpdate({$set: {'generation.stages.report': 'done'}}, approveId, false, user)
  } catch (e) { console.log('generation report stage done update error: ', e) }
  return result
};

export default generateReports;
