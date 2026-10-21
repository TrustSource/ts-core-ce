/* global swal:false , window:false */

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {moment} from 'meteor/momentjs:moment';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {AutoForm} from 'meteor/aldeed:autoform';
import {Spacebars} from 'meteor/spacebars';
import Projects from '/imports/lib/collections/projects';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Modules from '/imports/lib/collections/modules';
import Notify from '/imports/api/notify';
import {
  ModuleSchema,
  ModuleViabilityConfigSchema
} from '/imports/lib/schemas/moduleSchema';

import {BWLicenseEntrySchema, BWComponentEntrySchema, BWCveEntrySchema} from '/imports/lib/schemas/bwlistSchema';
import {EndoflifePolicy} from '/imports/lib/schemas/endoflifePolicySchema';
import {initScrollableTabs, destroyScrollableTabs} from '/imports/client/ui/common/scrollable-tabs';

const INPUT_NOT_DISABLED = 'input:not(:disabled)'
const BG_COLOR = 'background-color';
const LEANIX_APP = 'leanix-app'
const IE_MODULE = 'Internal Error! Module: '
const IE_CHECK = 'Internal Error! The check service is not available.'
const YES_UPDATE = 'Yes, update settings!'
const SUBMISSION_FAILED = 'Submission failed'
const SUMBISSION_ERROR = 'Error in onSubmit()'

Template.moduleSettings.onCreated(function () {
  const apiToken = Session.get('company');
  // The token stays on the server: leanixLogin signs in with the stored one.
  if (apiToken && apiToken.leanix && apiToken.leanix.companyName) {
    Session.set(LEANIX_APP, apiToken.leanix.companyName);
    Meteor.callAsync('leanixLogin').then(function(results) {
      if (results.data) {
        Session.set('leanix', results.data.access_token)
      } else {
        Session.set('leanix');
      }
    });
  } else {
    Session.set('leanix');
    Session.set(LEANIX_APP);
  }
});

Template.moduleSettings.onDestroyed(function () {
  destroyScrollableTabs(this);
  Session.set('getUsers');
  Session.set('getUsersComplianceManagers');
  Session.set('getUsersManagers');
  Session.set('getCompanyTags');
});

Template.moduleSettings.onRendered(function () {
  initScrollableTabs(this);
  this.autorun(function () {
    const user = Meteor.user();
    // Derive ids reactively from the route (available immediately on a hard refresh),
    // NOT from this.data captured at render time - on refresh the data context isn't
    // ready yet, leaving the ids undefined and the crypto/quality Finds returning empty.
    const params = (Router.current() && Router.current().params) || {};
    const moduleId = params.moduleId;
    const projectId = params.projectId;
    Meteor.callAsync('leanixProjects', Session.get('leanix'), Session.get(LEANIX_APP)).then(function(results) {
      Session.set('getLeanixProjects', results);
    });
    Session.set('importFilter');
    Session.set('getUsers');
    Session.set('getUsersComplianceManagers');
    Session.set('getUsersManagers');
    Session.set('getCompanyTags');
    if (user && user.profile) {
      Meteor.callAsync('getUsers', user).then(function(results) {
        let list = _.map(results, function (user) {
          return {label: user.profile.name, value: user._id}
        });
        Session.set('getUsers', list);
      });
      Meteor.callAsync('getUsersComplianceManagers', user).then(function(results) {
        let list = _.map(results, function (user) {
          return {label: user.profile.name, value: user._id}
        });
        list.unshift({label: '', value: ''});
        Session.set('getUsersComplianceManagers', list);
      });
      Meteor.callAsync('getUsersManagers', user).then(function(results) {
        let list = _.map(results, function (user) {
          return {label: user.profile.name, value: user._id}
        });
        list.unshift({label: '', value: ''});
        Session.set('getUsersManagers', list);
      });
      // Crypto / quality / algorithm lists are company-scoped (the server resolves
      // companyId from the logged-in user). Fetch them only once login is restored -
      // on a hard refresh a user-less call returns an empty list that can resolve last
      // and overwrite the real data, leaving the table blank.
      Meteor.callAsync('CryptoProperties.Find', {moduleId, projectId}).then(function(results) {
        Session.set('getAlgorithmSettingsList', results);
      });
      Meteor.callAsync('QualityProperties.Find', {moduleId, projectId}).then(function(results) {
        Session.set('getQualitySettingsList', results);
      });
      Meteor.callAsync('CryptoAlgorithms.Find', {moduleId, projectId}).then(function(results) {
        Session.set('getFoundAlgorithmsList', results && results.crypto_algorithms);
      });
      Meteor.callAsync('AiProperties.Find', {moduleId, projectId}).then(function(results) {
        Session.set('getAiModelsSettingsList', results);
      });
      Meteor.callAsync('AiModels.Find', {moduleId, projectId}).then(function(results) {
        Session.set('getFoundAiModelsList', results && results.ai_models);
      });
      // Inside the signed-in branch: Meteor.user() stays null until the login resume has
      // completed, and an earlier call reached the server anonymous and was refused with 401.
      Meteor.callAsync('getCompanyTags').then(function(results) {
        let list = _.map(results, function (tag) {
          return {label: tag.name, value: tag._id}
        });
        Session.set('getCompanyTags', list);
      });
    }
  });
  $('[data-toggle=popover]').popover();
  const module = Modules.findOne(this.data && this.data._id || this._id); // get a reactive datasource
  if (module) {
    const bgColor = '#f6d59d';
    const textColor = '#373737';
    const generalColor = module.generalSettingsValid() ? '' : bgColor;
    const legalColor = module.legalSettingsValid() ? '' : bgColor;
    if (!module.generalSettingsValid() && $('#general').find(INPUT_NOT_DISABLED).length) {
      $('#general-tab a').css(BG_COLOR, generalColor).css('color', textColor);
    }
    if (!module.legalSettingsValid() && $('#legal').find(INPUT_NOT_DISABLED).length) {
      $('#legal-tab a').css(BG_COLOR, legalColor).css('color', textColor);
    }
  }
  Meteor.setTimeout(() => {
    let form = $('#updateModuleForm')
    let nameField = form.find('input[name="name"]');
    if (form.length && nameField.val() && form.find(INPUT_NOT_DISABLED).length) {
      AutoForm.validateForm('updateModuleForm');
    }
  }, 500);
});

function getName(name) {
  return name ? '"' + name + '"' : '´without name´';
}

Template.moduleSettings.events({
  'click #releases .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('scanDetail', {_id: this._id});
    }
  },
  'click .copy-viability-settings': function (event) {
    event.preventDefault();
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    const srcModule = Modules.findOne({_id: event.target.id}, {fields: {name: 1, viabilityConfig: 1}});
    if (srcModule) {
      Meteor.callAsync('Modules.UpdateViabilityConfig', module._id, srcModule.viabilityConfig).then(function () {
        Notify.success('Viability settings copied from module: ' + (srcModule.name));
      }).catch(function (error) {
        console.log('Error updating Module:', error);
      });
    }
  },
  'click #module-archive': function (event) {
    event.preventDefault();
    const self = this;
    const name = getName(self.name);
    swal({
      title: 'Are you sure you want to archive module ' + name + '?',
      text: 'Module will be hidden from the list of active items in project overview!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#feba49',
      confirmButtonText: 'Yes, archive it!'
    }, function () {
      Meteor.callAsync('Modules.Archive', self._id, false).then(function () {
        const user = Meteor.user();
        Meteor.callAsync('modulesByProject', false, true).then(data => {
          Session.set('modulesByProject', data)
        })
        Meteor.callAsync('logEvent', user, 'Module ' + self.name + ' archived', 'moduleArchived');
        Notify.success('Module: ' + self.name + ' archived');
        Meteor.callAsync('updateCompanyStatistics', user.profile && user.profile.companyId);
        Router.go('projectModules', {projectId: Router.current().params.projectId});
      }).catch(function (err) {
        const user = Meteor.user();
        const message = IE_MODULE + name + ' not archived: ' + err;
        Meteor.callAsync('logEvent', user, message, 'moduleArchived');
        Notify.danger(message);
      });
    });
  },
  'click #module-unarchive': function (event) {
    event.preventDefault();
    const self = this;
    const name = getName(self.name);
    swal({
      title: 'Are you sure you want to unarchive module ' + name + '?',
      text: 'Module will be visible in the list of active items in project overview!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#feba49',
      confirmButtonText: 'Yes, unarchive it!'
    }, function () {
      Meteor.callAsync('Modules.Archive', self._id, true).then(function () {
        const user = Meteor.user();
        Meteor.callAsync('modulesByProject', false, true).then(data => {
          Session.set('modulesByProject', data)
        })
        Meteor.callAsync('logEvent', user, 'Module ' + self.name + ' unarchived', 'moduleArchived');
        Notify.success('Module: ' + self.name + ' unarchived');
        Meteor.callAsync('updateCompanyStatistics', user.profile && user.profile.companyId);
        Router.go('projectModules', {projectId: Router.current().params.projectId});
      }).catch(function (err) {
        const user = Meteor.user();
        const message = IE_MODULE + name + ' not unarchived: ' + err;
        Meteor.callAsync('logEvent', user, message, 'moduleArchived');
        Notify.danger(message);
      });
    });
  },
  'click #module-delete': function (event) {
    event.preventDefault();
    const self = this;
    const name = getName(self.name);

    swal({
      title: 'Are you sure you want to delete module ' + name + '?',
      text: 'You will not be able to recover your module!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    }, function () {
      Meteor.callAsync('Modules.Remove', self._id).then(function () {
        const user = Meteor.user();
        Meteor.callAsync('modulesByProject', false, true).then(data => {
          Session.set('modulesByProject', data)
        })
        Meteor.callAsync('logEvent', user, 'Module ' + self.name + ' deleted', 'moduleDeleted');
        Notify.success('Module: ' + self.name + ' deleted');
        Meteor.callAsync('updateCompanyStatistics', user.profile && user.profile.companyId);
        Router.go('projectModules', {projectId: Router.current().params.projectId});
      }).catch(function (err) {
        const user = Meteor.user();
        const message = IE_MODULE + name + ' not deleted: ' + err;
        Meteor.callAsync('logEvent', user, message, 'moduleDeleted');
        Notify.danger(message);
      });
    });
  },
  'click #module-delete-analysis': function (event) {
    event.preventDefault();
    const self = this;
    const name = getName(self.name);

    swal({
      title: 'Are you sure you want to delete the analysis history of the module ' + name + '?',
      text: 'You will not be able to recover the history, please analyse your module immediately!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    }, function () {
      Meteor.callAsync('deleteModuleAnalysis', self._id).then(function() {
        const user = Meteor.user();
        Meteor.callAsync('updateCompanyStatistics', user.profile.companyId);
        Notify.success('Analysis history of: ' + name + ' deleted');
      }).catch(function(_error) {
        Notify.danger('Internal Error! Analysis history of: ' + name + ' not deleted');
      });
    });
  },
  'click .delete-analysis': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    let analysis = this;
    let moduleParent = Template.parentData(2);
    let moduleCurrent = Template.parentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    Meteor.callAsync('removeSingleAnalysis', analysis._id).then(function (data) {
      if (data !== 1) {
        Notify.danger('Internal Error! Analysis item not deleted');
      } else {
        Notify.success('Analysis successfully deleted');
        Meteor.callAsync('logEvent', user, module.name + ' - ' + moment(analysis.date).format('llll'), 'moduleAnalysisDeleted');
      }
    }).catch(function (err) {
      console.log(err);
      Notify.danger(err.reason || 'Internal Error! Analysis item not deleted');
    });
  },
  'click input[name="viabilityConfigEnabled"]': function (event) {
    event.preventDefault();
    swal({
      title: 'Are you sure you want to update Viability analysis settings?',
      text: 'This will re-process module to update status and statistics!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#2a94a2',
      confirmButtonText: YES_UPDATE
    }, function () {
      const user = Meteor.user();
      const module = Modules.findOne({_id: Router.current().params.moduleId}, {
        fields: {
          name: true,
          viabilityConfig: true,
          infrastructureComponent: true,
          cotsComponent: true
        }
      });
      let viabilityConfig = module.viabilityConfig || {};
      viabilityConfig.enabled = !(module && module.viabilityConfig && module.viabilityConfig.enabled);
      Meteor.callAsync('Modules.UpdateViabilityConfig', module._id, viabilityConfig).then(function () {
        Meteor.callAsync('logEvent', user, 'Module ' + module.name + ' viability settings changed', 'moduleViabilitySettingsUpdated');
        Notify.success('Modules viability settings successfully changed');
        if((module.infrastructureComponent && module.infrastructureComponent.key) ||
          (module.cotsComponent && module.cotsComponent.key)){
          Meteor.callAsync('Modules.AnalyzeWithoutScan', module._id).then(function(data) {
            if (!data) {
              Notify.danger(IE_CHECK);
            }
          })
        }else{
          Meteor.callAsync('analyzeModule', module._id).then(function(data) {
            if (!data) {
              Notify.danger(IE_CHECK);
            }
          });
        }
      }).catch(function (err) {
        Notify.danger(err.message);
      });
    });
  },
  'input .import_filter': function (event) {
    Session.set('importFilter', $(event.target).val())
  },
  'click input[name="endoflifeConfigEnabled"]': function (event) {
    event.preventDefault();
    let self = this;
    swal({
      title: 'Are you sure you want to update end-of-life policy?',
      text: 'This will affect all future analysis!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#2a94a2',
      confirmButtonText: YES_UPDATE
    }, async function () {
      const user = Meteor.user();
      const module = Modules.findOne({_id: self._id}, {
        fields: {
          name: true,
          endoflifePolicy: true,
          infrastructureComponent: true,
          cotsComponent: true
        }
      });
      let endoflifePolicy = module.endoflifePolicy || {};
      endoflifePolicy.enabled = !(module && module.endoflifePolicy && module.endoflifePolicy.enabled);
      try {
        await Meteor.callAsync('Modules.UpdateEndoflifePolicy', module._id, endoflifePolicy);
        Meteor.callAsync('logEvent', user, 'Module end-of-life policy changed', 'moduleEndoflifePolicyUpdated');
        Notify.success('Module end-of-life policy successfully changed');
      } catch (error) {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, error.message, 'moduleEndoflifePolicyUpdated');
      }
    });
  }
});

Template.moduleSettings.helpers({
  currentModule: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    return moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
  },
  // When the module has no confidence level of its own, surface the project value it inherits.
  inheritedConfidenceHint: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    if (!module || module.confidenceMinScore) return null;
    const project = module.projectId ? Projects.findOne(module.projectId) : null;
    const value = project && project.confidenceMinScore;
    if (!value) return null;
    const labels = {'5': 'High only', '4': 'Medium +', '1': 'All'};
    return labels[value] || value;
  },
  method: function () {
    return 'Scans.Find'
  },
  filters: function () {
    return ['project', 'module', 'user', 'branch', 'tag'];
  },
  sortings: function () {
    return ['submitted', 'project', 'module', 'user', 'branch', 'tag', 'dependencyCount'];
  },
  options: function () {
    return {
      sort: {submitted: -1},
      selector: {
        moduleId: Router.current().params.moduleId
      }
    };
  },
  fields: function () {
    return [
      {
        fieldId: 'submitted',
        key: 'submitted',
        label: 'When',
        sortable: false,
        cellClass: 'col-date',
        tmpl: Template.reactiveTableDateCell
      },
      {
        fieldId: 'project',
        key: 'project',
        sortable: false,
        label: 'Project - Module',
        fn: function (value, object) {
          return object.project + ' - ' + object.module;
        }
      },
      {
        fieldId: 'user',
        key: 'user',
        sortable: false,
        label: 'Upload by',
        fn: function (value, object) {
          return object.user;
        }
      },
      {
        fieldId: 'dependencyCount',
        key: 'dependencyCount',
        label: 'Dependencies',
        sortable: false,
        fn: function (value, object) {
          return new Spacebars.SafeString('<span class="badge" sort=' + (object.dependencyCount || 0) + '>' +
            (object.dependencyCount || 0) + '</span>');
        }
      },
      {
        fieldId: 'release',
        key: 'release',
        label: 'Release',
        sortable: false,
        fn: function (value, object) {
          return object.release;
        }
      },
      {
        fieldId: 'tag',
        key: 'tag',
        label: 'Meta',
        sortable: false,
        fn: function (value, object) {
          let list = [];
          if (object.branch) {
            list.push('<span class="fa fa-code-fork inner-r-5" title="Branch"></span><span>' + object.branch + '</span>')
          }
          if (object.tag) {
            list.push('<span class="fa fa-tag inner-r-5" title="Tag"></span><span>' + object.tag + '</span>')
          }
          return new Spacebars.SafeString(list.join('<span class="inner-r-10"></span>'));
        }
      }
    ]
  },
  projectOptions: function () {
    return Projects.find().map(function (p) {
      return {
        label: p.name,
        value: p._id
      };
    });
  },

  getViabilitySettingsModules: function () {
    const moduleArray = Modules.find(
      {_id: {$ne: this._id}, viabilityConfig: {$exists: true}, name: {$exists: true}}).fetch();
    return _.filter(moduleArray, m => m.viabilitySettingsValid());
  },

  getWhitelistedComponents: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company');
      let projectList = [];
      let companyList = [];
      if (project) {
        projectList = project.componentConfig && project.componentConfig.whitelist || [];
      }
      if (company) {
        companyList = company.componentConfig && company.componentConfig.whitelist || [];
      }
      let moduleList = module.componentConfig && module.componentConfig.whitelist || [];
      projectList.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
      companyList.map(function (elem) {
        elem.companyItem = true;
        return elem
      });
      return companyList.concat(projectList.concat(moduleList));
    }
  },

  getBlacklistedComponents: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company');
      let projectList = [];
      let companyList = [];
      if (project) {
        projectList = project.componentConfig && project.componentConfig.blacklist || [];
      }
      if (company) {
        companyList = company.componentConfig && company.componentConfig.blacklist || [];
      }
      let moduleList = module.componentConfig && module.componentConfig.blacklist || [];
      projectList.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
      companyList.map(function (elem) {
        elem.companyItem = true;
        return elem
      });
      return companyList.concat(projectList.concat(moduleList));
    }
  },

  getWhitelistedLicenses: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company');
      let projectList = [];
      let companyList = [];
      if (project) {
        projectList = project.licenseConfig && project.licenseConfig.whitelist || [];
      }
      if (company) {
        companyList = company.licenseConfig && company.licenseConfig.whitelist || [];
      }
      let moduleList = module.licenseConfig && module.licenseConfig.whitelist || [];
      projectList.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
      companyList.map(function (elem) {
        elem.companyItem = true;
        return elem
      });
      return companyList.concat(projectList.concat(moduleList));
    }
  },

  getBlacklistedLicenses: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company');
      let projectList = [];
      let companyList = [];
      if (project) {
        projectList = project.licenseConfig && project.licenseConfig.blacklist || [];
      }
      if (company) {
        companyList = company.licenseConfig && company.licenseConfig.blacklist || [];
      }
      let moduleList = module.licenseConfig && module.licenseConfig.blacklist || [];
      projectList.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
      companyList.map(function (elem) {
        elem.companyItem = true;
        return elem
      });
      return companyList.concat(projectList.concat(moduleList));
    }
  },

  getWhitelistedCve: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company');
      let projectList = [];
      let companyList = [];
      if (project) {
        projectList = project.cveConfig && project.cveConfig.whitelist || [];
      }
      if (company) {
        companyList = company.cveConfig && company.cveConfig.whitelist || [];
      }
      let moduleList = module.cveConfig && module.cveConfig.whitelist || [];
      projectList.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
      companyList.map(function (elem) {
        elem.companyItem = true;
        return elem
      });
      return companyList.concat(projectList.concat(moduleList));
    }
  },

  getBlacklistedCve: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company');
      let projectList = [];
      let companyList = [];
      if (project) {
        projectList = project.cveConfig && project.cveConfig.blacklist || [];
      }
      if (company) {
        companyList = company.cveConfig && company.cveConfig.blacklist || [];
      }
      let moduleList = module.cveConfig && module.cveConfig.blacklist || [];
      projectList.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
      companyList.map(function (elem) {
        elem.companyItem = true;
        return elem
      });
      return companyList.concat(projectList.concat(moduleList));
    }
  },

  getAlgorithmList: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company');
      let projectList = [];
      let companyList = [];
      if (project) {
        projectList = project.algorithmsConfig || [];
      }
      if (company) {
        companyList = company.algorithmsConfig || [];
      }
      let moduleList = module.algorithmsConfig || [];
      projectList.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
      companyList.map(function (elem) {
        elem.companyItem = true;
        return elem
      });
      return _.sortBy(companyList.concat(projectList.concat(moduleList)),'key');
    }
  },
  endoflifePolicy: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    const module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent;
    return module && module.endoflifePolicy || {}
  },
  getFoundAlgorithmsList: function () {
    return Session.get('getFoundAlgorithmsList')
  },
  getAlgorithmSettingsList: function () {
    return Session.get('getAlgorithmSettingsList')
  },
  getAiModelsSettingsList: function () {
    return Session.get('getAiModelsSettingsList')
  },
  getFoundAiModelsList: function () {
    return Session.get('getFoundAiModelsList')
  },
  getQualitySettingsList: function () {
    return Session.get('getQualitySettingsList')
  },
  getProjectOptions: function () {
    return {
      projectId: this._id
    };
  },
  getViabilityConfig: function () {
    let moduleParent = Template.parentData();
    return moduleParent && moduleParent.viabilityConfig || {};
  },
  getComponentWhitelistTooltip: function () {
    return {
      title: 'Always allow component',
      content: `In the 'Always allow component' you specify components which are allowed, i.e not included in the
          result evaluation.<br /> You have to enter a key and a version to identify allowed components. In key
          expressions a wildcard character ('*')<br /> is allowed for every part (separated by ':') as last character.
          In the version field only one wildcard charachter ('*') is<br /> allowed and it must be the last character
          of the expression.
          <ul>Some examples for key entries:
            <li>mvn:my.compnanies.groupId:*</li>
            <li>*:mycompany:*</li>
          </ul>
          <ul> Some examples for version entries:
            <li>*</li>
            <li>1.*</li>
            <li>3.6.*</li>
          </ul>`
    };
  },
  getComponentBlacklistTooltip: function () {
    return {
      title: 'Always deny component',
      content: `In the 'Always deny component' you specify components which are denied, i.e always forced to fail in
          the result evaluation.<br /> You have to enter a key and a version to identify denied components. In key
          expressions a wildcard character ('*')<br /> is allowed for every part (separated by ':') as last character.
          In the version field only one wildcard charachter ('*') is<br /> allowed and it must be the last character of
          the expression.
          <ul>Some examples for key entries:
            <li>mvn:my.compnanies.groupId:*</li>
            <li>*:mycompany:*</li>
          </ul>
          <ul> Some examples for version entries:
            <li>*</li>
            <li>1.*</li>
            <li>3.6.*</li></ul>`
    };
  },
  getModules() {
    return Modules;
  },
  getModuleSchema() {
    return ModuleSchema;
  },
  getModuleViabilityConfigSchema() {
    return ModuleViabilityConfigSchema;
  },
  getModuleComponentEntrySchema() {
    return BWComponentEntrySchema;
  },
  getModuleCveEntrySchema() {
    return BWCveEntrySchema;
  },
  getModuleLicenseEntrySchema() {
    return BWLicenseEntrySchema;
  },
  getEndoflifeSchema() {
    return EndoflifePolicy;
  },
  getFieldValue: function (fieldName) {
    return AutoForm.getFieldValue(fieldName);
  },
  isInfrastructureModule: function () {
    return (this && this.properties &&
      (this.properties.architecture === 'infrastructureModule' ||
        this.properties.architecture === 'infrastructureTemplate')) ||
      (this && this.properties &&
        (this.properties.architecture === 'cotsModule' ||
          this.properties.architecture === 'cotsTemplate'))
  },
  getLeanixProjects: function () {
    return Session.get('getLeanixProjects')
  },
  hasLeanix: function () {
    return Session.get('leanix') && Session.get(LEANIX_APP)
  },
  hasLeanixAndNotLeanixProjects: function () {
    return Session.get('leanix') && Session.get(LEANIX_APP) && !Session.get('getLeanixProjects')
  },
  moduleAnalysis: function () {
    const user = Meteor.user();
    let filter = {
      companyId: user.profile.companyId,
      moduleId: Router.current().params.moduleId
    };
    return ModuleAnalysis.find(filter, {
      sort: {date: -1}, limit: 100,
      fields: {date: 1, release: 1, licenses: 1, components: 1}
    }).fetch()
  },
  licensesChartData: function () {
    let analysis = Template.currentData();
    if (analysis && analysis.date) {
      let license = {};
      let licenses = analysis.licenses;
      license.total = licenses.length;
      license.warnings = _.filter(licenses, function (item) {
        return item.status === 'warnings';
      }).length;
      license.violations = _.filter(licenses, function (item) {
        return item.status === 'violations';
      }).length;
      license.ok = Math.max(0, license.total - license.warnings - license.violations);
      if (license.total !== 0) {
        license.okPercent = (license.ok * 100) / license.total;
        license.warningsPercent = (license.warnings * 100) / license.total;
        license.violationsPercent = (license.violations * 100) / license.total;
      } else {
        license.okPercent = 0;
        license.warningsPercent = 0;
        license.violationsPercent = 0;
      }
      return license;
    }
  },
  componentChartData: function () {
    let analysis = Template.currentData();
    if (analysis && analysis.date) {
      let component = {};
      let componentList = analysis.components;
      component.total = componentList.length;
      component.warnings = _.filter(componentList, function (item) {
        return item.status === 'warnings';
      }).length;
      component.violations = _.filter(componentList, function (item) {
        return item.status === 'violations';
      }).length;
      component.ok = Math.max(0, component.total - component.warnings - component.violations);
      component.okPercent = (component.ok * 100) / component.total;
      component.warningsPercent = (component.warnings * 100) / component.total;
      component.violationsPercent = (component.violations * 100) / component.total;
      return component;
    }
  },

  getUsersManagers: function () {
    let users = Session.get('getUsersManagers');
    return (users && users.length > 1) ? users : [];
  },

  getUsersComplianceManagers: function () {
    let users = Session.get('getUsersComplianceManagers');
    return (users && users.length > 1) ? users : [];
  },

  getUsers: function () {
    let users = Session.get('getUsers');
    return (users && users.length > 1) ? users : [];
  },

  inProgressGetUsers: function () {
    return !Session.get('getUsers');
  },

  hasNoUsers: function () {
    let users = Session.get('getUsers');
    return users && users.length === 0;
  },

  inProgressGetUsersComplianceManagers: function () {
    return !Session.get('getUsersComplianceManagers');
  },

  hasNoUsersComplianceManagers: function () {
    let users = Session.get('getUsersComplianceManagers');
    return users && users.length <= 1;
  },

  inProgressGetUsersManagers: function () {
    return !Session.get('getUsersManagers');
  },

  hasNoUsersManagers: function () {
    let users = Session.get('getUsersManagers');
    return users && users.length <= 1;
  },

  filterList: function (list, filter) {
    return _.filter(list, m => {
      return m.getName().toLowerCase().indexOf(filter.toLowerCase()) > -1
    }).slice(0, 9);
  },

  getImportFilter: function () {
    return Session.get('importFilter') || '';
  },

  getCompanyTags: function () {
    return Session.get('getCompanyTags');
  },

  inProgressGetCompanyTags: function () {
    return !Session.get('getCompanyTags');
  },

  hasNoCompanyTags: function () {
    let tags = Session.get('getCompanyTags');
    return tags && tags.length === 0;
  },

  isAllFormDisabled: function () {
    let tags = Session.get('getCompanyTags');
    return tags && tags.length === 0;
  }
});

AutoForm.hooks({
  updateModuleFormEndoflifeConfig: {
    onSubmit: function (insertDoc) {
      let self = this;
      const formContext = Template.currentData();
      insertDoc.enabled = true;
      Meteor.callAsync('Modules.UpdateEndoflifePolicy', formContext.docId, insertDoc).then(function () {
        const user = Meteor.user();
        Meteor.callAsync('logEvent', user, 'Module end-of-life policy changed', 'moduleEndoflifePolicyUpdated');
        Notify.success('Module end-of-life policy successfully changed');
        self.done();
      }).catch(function (error) {
        console.log(SUMBISSION_ERROR, error);
        Notify.danger(error.message || SUBMISSION_FAILED);
        self.done(new Error(SUBMISSION_FAILED));
      });
      return false;
    },
    onError: function (formType, error) {
      if (error && error.message) {
        Notify.danger(error.message);
      }
    }
  },
  updateModuleForm: {
    before: {
      'update': function (doc) {
        this.event.preventDefault();
        if (this.currentDoc.leanix !== doc.$set.leanix && Session.get('leanix') && Session.get(LEANIX_APP)) {
          Meteor.callAsync('leanixProjectsUpdate', Session.get('leanix'), this.currentDoc, true);
          Meteor.callAsync(
            'leanixProjectsUpdate',
            Session.get('leanix'),
            doc.$set,
            false,
            window.location.href.replace('/settings', ''),
            'module'
          );
        }
        if (this.currentDoc.version !== doc.$set.version) {
          if(this.currentDoc.infrastructureComponent){
            doc.$set['infrastructureComponent.version'] = doc.$set.version
            doc.$set['analysisRequired'] = true
          }
          if(this.currentDoc.cotsComponent){
            doc.$set['cotsComponent.version'] = doc.$set.version
            doc.$set['analysisRequired'] = true
          }
        }
        return doc;
      }
    },
    onSuccess: function () {
      const user = Meteor.user();
      const module = Modules.findOne(Router.current().params.moduleId, {fields: {name: true}});
      Meteor.callAsync('logEvent', user, 'Module ' + module.name + ' general settings changed', 'moduleSettingsUpdated');
      Notify.success('Module settings changed!');
      Meteor.callAsync('modulesByProject', false, true).then(data => {
        Session.set('modulesByProject', data)
      })
    },
    onError: function (formType, error) {
      // occured error is no validation error
      if (error.errorType === 'Meteor.Error') {
        const user = Meteor.user();
        let warning = 'Internal Error! General settings not changed: ' + error.message;
        Notify.danger(warning);
        Meteor.callAsync('logEvent', user, warning, 'moduleSettingsUpdated');
      }
    }
  },
  updateModuleForm3: {
    onSubmit: function (insertDoc) {
      let self = this;
      const formContext = Template.currentData();
      const module = Modules.findOne(Router.current().params.moduleId, {fields: {name: true}});
      insertDoc.enabled = formContext.doc.enabled;
      Meteor.callAsync('Modules.UpdateViabilityConfig', formContext.docId, insertDoc).then(function () {
        const user = Meteor.user();
        Meteor.callAsync('logEvent', user, 'Module ' + module.name + ' viability settings changed', 'moduleViabilitySettingsUpdated');
        Notify.success('Viability settings changed!');
        self.done();
      }).catch(function (error) {
        console.log(SUMBISSION_ERROR, error);
        Notify.danger(error.message || SUBMISSION_FAILED);
        self.done(new Error(SUBMISSION_FAILED));
      });
      return false;
    },
    onError: function () {
      console.log('updateModuleForm3-onError: ', arguments);
    }
  }
});
