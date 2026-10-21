import _ from 'underscore';
import {Meteor} from 'meteor/meteor';
import {Mongo} from 'meteor/mongo';
import {Session} from 'meteor/session';
import Project from '/imports/lib/project/Project';
import Module from '/imports/lib/project/Module';
import Statistics from '/imports/lib/project/Statistics';

const Projects = new Mongo.Collection('projects', {
  transform: function (doc) {
    return new Project(doc);
  }
});

export default Projects;

Projects.UNASSIGNED = '$unassigned';

function mapProject(project, moduleFilter) {
  if (project && project._id) {
    let stats = {
      licenses: 0,
      components: 0,
      legal: {
        warnings: 0,
        violations: 0
      },
      vulnerability: {
        warnings: 0,
        violations: 0
      },
      viability: {
        warnings: 0,
        violations: 0
      },
      integrity: {
        warnings: 0,
        violations: 0
      },
      getAll: function () {
        const result = {};
        ['legal', 'vulnerability', 'viability', 'integrity'].forEach(k => {
          let r = _.clone(this[k]);
          r.total = this.components;
          r.ok = Math.max(0, r.total - r.warnings - r.violations);
          r.okPercent = (r.ok * 100) / r.total;
          r.warningsPercent = (r.warnings * 100) / r.total;
          r.violationsPercent = (r.violations * 100) / r.total;
          result[k] = r;
        });
        return result;
      }
    };
    let modules = Session.get('modulesByProject');
    let listModules = _.map(_.filter(modules, (module)=>{
      if(((moduleFilter && moduleFilter === 'COMPONENT' && !(module.infrastructureComponent || module.cotsComponent)) ||
        (moduleFilter && moduleFilter === 'MODULE' && (module.infrastructureComponent || module.cotsComponent))) || module.archived){
        return false
      }
      return module.projectId === project._id
    }), (module)=>{
      return new Module(module)
    });
    let quality = {
      ok: 0,
      warnings: 0,
      violations: 0,
      total: 0
    }
    _.each(listModules, function (element) {
      const statistic = element.getStatistics();
      project.analyzed = getBiggerDate(project.analyzed,element.analyzed);
      stats.licenses += statistic.licenses;
      stats.components += statistic.components;
      stats.legal.warnings += statistic.legal.warnings;
      stats.legal.violations += statistic.legal.violations;
      stats.vulnerability.warnings += statistic.vulnerability.warnings;
      stats.vulnerability.violations += statistic.vulnerability.violations;
      stats.viability.warnings += statistic.viability.warnings;
      stats.viability.violations += statistic.viability.violations;
      stats.integrity.warnings += statistic.integrity.warnings;
      stats.integrity.violations += statistic.integrity.violations;
      const qualityData = element.getQuality();
      quality.ok += qualityData.ok ? qualityData.ok : 0;
      quality.warnings += qualityData.warnings ? qualityData.warnings : 0;
      quality.violations += qualityData.violations ? qualityData.violations : 0;
      quality.total += (qualityData.ok ? qualityData.ok : 0) + (qualityData.warnings ? qualityData.warnings : 0) +
        (qualityData.violations ? qualityData.violations : 0);
    });
    listModules = _.sortBy(listModules, function (i) { return i.name }); // .toLowerCase();
    project.listModules = listModules;
    project.moduleCount = listModules.length;
    project.getStatistics = function () {
      return new Statistics(stats);
    };
    project.getQuality = function () {
      const {ok, warnings, violations, total} = quality;
      let data = {ok, warnings, violations, total};
      data.okPercent = data.total ? (data.ok * 100) / data.total : 0;
      data.warningsPercent = data.total ? (data.warnings * 100) / data.total : 0;
      data.violationsPercent = data.total ? (data.violations * 100) / data.total : 0;
      return data;
    };
    project.repository = project.github && project.github.active ? project.github.repository : null
  }
  return project;
}

if (Meteor.isClient) {
  Projects.findMapped = function (filterObj, moduleFilter) {
    let filter = filterObj ? filterObj : {}
    return this.find(filter,{sort: {'name': 1}}).map((item)=>{
      return mapProject(item, moduleFilter)
    });
  };

  Projects.findOneMapped = function (selector, options) {
    return mapProject(this.findOne(selector, options));
  };

  Projects.findUnassigned = function () {
    return mapProject({name: 'Unassigned Modules', _id: Projects.UNASSIGNED})
  }
}


function getBiggerDate(a,b) {
  if(!a && b){
    return b
  }else if(!b && a){
    return a
  }else if (a && b){
    return (a > b) ? a : b
  }
  return false
}
