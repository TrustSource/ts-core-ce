import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import RiskProperties from '/imports/lib/collections/riskProperties';
import Utils from '/imports/server/ServerUtils';
import {OVERDUE_RISK_STATES, OPEN_RISK_WARNING_STATES} from '/imports/lib/schemas/riskSchema';


const getPortfolio = async function (projectId, moduleIds) {
  let statsArr = [];
  const userId = this.userId;
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  let filter = {
    companyId: companyId
  };
  if(projectId){
    filter._id = projectId;
  }
  const projects = await Projects.find(filter, {fields:{name: 1, _id: 1}}).fetchAsync();
  for (const project of projects) {
    let filter = {
      companyId: companyId,
      projectId: project._id
    };
    if(moduleIds){
      filter._id = { $in : moduleIds}
    }
    const modules = await Modules.find(filter, {fields:{name: 1, _id: 1}}).fetchAsync();
    for (const element of modules) {
      const statistic = await findStats({
        companyId: filter.companyId,
        moduleId: element._id
      });
      statsArr.push({
        _id: element._id,
        title: element.name || element.getName(),
        project: project.name || project.getName(),
        projectId: project._id,
        risks: statistic.risks,
        stats: {
          impact : statistic.impact,
          state : statistic.state
        }
      })
    }
    const statistic = await findStats({
      companyId: filter.companyId,
      projectId: filter.projectId
    });
    statsArr.push({
      _id: project._id,
      title: 'Project risks',
      project: project.name || project.getName(),
      projectId: project._id,
      risks: statistic.risks,
      stats: {
        impact : statistic.impact,
        state : statistic.state
      }
    })
  }
  return statsArr;
};


const findStats = async function (params) {
  const companyId = params.companyId;
  let list = []
  if(params.moduleId){
    // Shapes 2 AND 3 (see listQuery.js): a module-scoped risk may or may not
    // also carry a projectId. Requiring projectId to be absent counted only
    // shape 2, so every shape-3 risk was missing from this page - which is
    // every risk created through the threat-model REST flow, and every risk the SARIF importer
    // maintains. A module with nothing but shape-3 risks reported zero, and the
    // overview then rendered its "No risks tracked yet" empty state while the
    // risk list beside it listed them (the list has always matched both shapes).
    //
    // The project branch below stays project-ONLY on purpose: it is rendered as
    // a separate "Project risks" row next to one row per module, so widening it
    // the same way would count every module risk twice.
    let filter  = {companyId, moduleId: params.moduleId}
    list = await RiskProperties.find(filter, {fields: {'riskProperties.impactClass': 1, 'riskProperties.state': 1}}).fetchAsync()
  }else if(params.projectId){
    let filter = {companyId, projectId: params.projectId, moduleId: {$exists: false}}
    list = await RiskProperties.find(filter, {fields: {'riskProperties.impactClass': 1, 'riskProperties.state': 1}}).fetchAsync()
  }
  const warningsImpact = [
    'high',
    'moderate']
  const violationsImpact = [
    'critical',
    'existential']
  // The same classification as the tiles: resolved states are neither.
  const warningsStates = OPEN_RISK_WARNING_STATES
  const violationsStates = OVERDUE_RISK_STATES
  return {
    risks: list.length,
    impact: {
      warnings: _.filter(list, item => {
        return warningsImpact.indexOf(item.riskProperties.impactClass) > -1
      }).length,
      violations: _.filter(list, item => {
        return violationsImpact.indexOf(item.riskProperties.impactClass) > -1
      }).length
    },
    state: {
      warnings: _.filter(list, item => {
        return warningsStates.indexOf(item.riskProperties.state) > -1
      }).length,
      violations: _.filter(list, item => {
        return violationsStates.indexOf(item.riskProperties.state) > -1
      }).length
    }
  };
};

export default getPortfolio;
