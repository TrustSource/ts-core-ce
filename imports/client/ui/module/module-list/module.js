import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import Notify from '/imports/api/notify';

Template.module.events({
  'click .module-settings': function (event) {
    event.stopPropagation(); // prevent triggering of .panel-body event
    const projectId = this.projectId || Projects.UNASSIGNED;
    Router.go('moduleSettings', {moduleId: this._id, projectId: projectId});
  },
  'click .module-analyze': function (event) {
    event.stopPropagation(); // prevent triggering of .panel-body event
    Notify.success('Analysis started');
    const module = this
    if((module.infrastructureComponent && module.infrastructureComponent.key) ||
      (module.cotsComponent && module.cotsComponent.key)){
      Meteor.callAsync('Modules.AnalyzeWithoutScan', module._id).then(function() {
        Notify.success('Module was successfully analyzed.');
      }).catch(function(error) {
        Notify.danger('Analysis error: '+ (error.reason));
      })
    }else{
      Meteor.callAsync('analyzeModule', module._id).then(function() {
        Notify.success('Module was successfully analyzed.');
      }).catch(function(error) {
        Notify.danger('Analysis error: '+ (error.reason));
      })
    }
  },
  'click .panel-body': function () {
    const projectId = this.projectId || Projects.UNASSIGNED;
    Router.go('moduleDependencies', {moduleId: this._id, projectId: projectId});
  }
});

function isAnalysisInProgress(module) {
  return module.status && !!module.status.match(/in progress/);
}

Template.module.helpers({
  // The license of the catalog version an infrastructure module was created from;
  // nothing in CE fills crawlerInfo, which the card used to read.
  catalogLicense: function () {
    const ref = this.infrastructureComponent;
    const entry = ref && ref.key && InfrastructureComponents.findOne({key: ref.key}, {transform: null});
    const version = entry && _.find(entry.versions || [], function (item) {
      return item.version === ref.version
    });
    return version ? _.map(version.licenses || [], function (license) {
      return license.key || license.name
    }).join(', ') : '';
  },
  lastAnalysisWarnings: function () {
    return (this.scanned && !this.analyzed) || (this.scanned && this.analyzed && this.scanned > this.analyzed)
  },

  lastScanWarnings: function () {
    let lastScanDate = this.scanned;
    if (lastScanDate) {
      let deltaInMillis = new Date() - lastScanDate;
      return (deltaInMillis > (7 * 24 * 3600 * 1000));
    }
    return false;
  },

  analyseButtonDisabledAttr: function () {
    return isAnalysisInProgress(this) ? 'disabled' : '';
  },

  analyseButtonText: function () {
    return isAnalysisInProgress(this) ? 'Analysis in progress' : 'Analyse Module';
  },

  getArchitectureType: function (type) {
    if (type) {
      const types = [
        {label: 'Frontend-UI-Module', value: 'FEU'},
        {label: 'Frontend-Endpoint', value: 'FEE'},
        {label: 'Frontend-Service', value: 'FES'},
        {label: 'Backend-Service', value: 'BES'},
        {label: 'Backend-Endpoint', value: 'BEE'},
        {label: 'System component', value: 'SC'},
        {label: 'Infrastructure Service', value: 'IS'},
        {label: 'Distributable Component', value: 'DC'}
      ];
      let item = _.find(types, function (item) {
        return item.value === type
      });
      return item.label;
    }
  },

  isInfrastructureModule: function () {
    return (this && this.properties &&
      (this.properties.architecture === 'infrastructureModule' ||
      this.properties.architecture === 'infrastructureTemplate')) ||
      (this && this.properties &&
      (this.properties.architecture === 'cotsModule' ||
      this.properties.architecture === 'cotsTemplate'))
  },

  isLinkedProject: function () {
    return this && this.linkedProject && this.linkedProject.projectId
  },

  isInfrastructureTemplate: function () {
    return (Template.currentData() && Template.currentData().properties &&
    (Template.currentData().properties.architecture === 'infrastructureModule' ||
    Template.currentData().properties.architecture === 'infrastructureTemplate'))
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});
