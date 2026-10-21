/* global swal:false, window:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import {Tracker} from 'meteor/tracker';
import {AutoForm} from 'meteor/aldeed:autoform';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Roles} from 'meteor/alanning:roles';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import UserExtUtils from '/imports/lib/userExtUtils';
import {WEBHOOK_ADMIN_ROLES} from '/imports/lib/company/webhookAccess';
import {ProjectSchema, PROJECT_DESCRIPTION_MAX} from '/imports/lib/schemas/projectSchema';
import {BWLicenseEntrySchema, BWComponentEntrySchema, BWCveEntrySchema} from '/imports/lib/schemas/bwlistSchema';
import {EndoflifePolicy} from '/imports/lib/schemas/endoflifePolicySchema';
import {initScrollableTabs, destroyScrollableTabs} from '/imports/client/ui/common/scrollable-tabs';

const LEANIX_APP = 'leanix-app'
const OPTION_SELECTED = 'option:selected'
const IE = 'Internal Error: '
const NOT_DELETED = ' not deleted'
const ARCHITECTURE_UPLOAD_BUTTON = '.action-upload-architecture'
const ARCHITECTURE_FILE_INPUT = '.architecture-file-input'
const ARCHITECTURE_FILE_EXTENSIONS = ['.md', '.markdown']
const ARCHITECTURE_GENERIC_ERROR = 'Internal Error! Application goals could not be updated.'
// Must stay in step with Projects.UpdateAutoCreateCweRisks' own role list - a user
// holding the field right but none of these would otherwise see an enabled toggle
// that answers with a 403 toast.
const AUTO_CWE_ROLES = ['account_admin', 'manager', 'compliance_manager']
// Every projects interactor throws this on a zero-count update. Surfacing it would
// compose "Could not save the setting: Could not update db" - a doubled "Could not"
// that also leaks a storage-layer word at the user.
const AUTO_CWE_INTERNAL_ERROR = 'Could not update db'

// Pure helpers so the checks can be reasoned about / unit-tested independently
// of the DOM and Blaze event wiring.
function getFileExtension(fileName) {
  if (!fileName) {
    return '';
  }
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

export function isArchitectureFileExtensionValid(fileName) {
  return ARCHITECTURE_FILE_EXTENSIONS.indexOf(getFileExtension(fileName)) > -1;
}

export function isArchitectureFileSizeValid(fileSize) {
  return typeof fileSize === 'number' && fileSize <= PROJECT_DESCRIPTION_MAX;
}

function forceDeleteAndRedirect(project, name) {
  Meteor.callAsync('forceDeleteProject', project).then(function() {
    Notify.success('Project: ' + name + ' deleted');
    Meteor.setTimeout(()=>{
      Router.go('projectList');
    }, 100)
  }).catch(function(error) {
    const message = IE + (error.reason || 'Project: ' + name + NOT_DELETED);
    Notify.danger(message);
  });
}

Template.projectSettings.onDestroyed(function () {
  destroyScrollableTabs(this);
  Session.set('getUsers');
  Session.set('getUsersComplianceManagers');
  Session.set('getUsersManagers');
  Session.set('getCompanyTags');
});

Template.projectSettings.onCreated(function () {
  this.architectureUploading = new ReactiveVar(false);
  this.autoCweSaving = new ReactiveVar(false);
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
  // Reactive so company-scoped fetches retry when login is restored on a hard refresh
  // (onCreated runs once; without this the lists stay empty if the user wasn't ready).
  this.autorun(function () {
    const user = Meteor.user();
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
      // Id from the route (reactive + available immediately on refresh), not this.data.
      const params = (Router.current() && Router.current().params) || {};
      const projectId = params.projectId;
      if (projectId) {
        Meteor.callAsync('CryptoProperties.Find', {projectId: projectId}).then(function(results) {
          Session.set('getAlgorithmSettingsList', results);
        });
        Meteor.callAsync('QualityProperties.Find', {projectId: projectId}).then(function(results) {
          Session.set('getQualitySettingsList', results);
        });
        Meteor.callAsync('CryptoAlgorithms.Find', {projectId: projectId}).then(function(results) {
          Session.set('getFoundAlgorithmsList', results.crypto_algorithms);
        });
      }
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
});

Template.projectSettings.onRendered(function () {
  initScrollableTabs(this);
  this.autorun(function () {
    Meteor.callAsync('leanixProjects', Session.get('leanix'), Session.get(LEANIX_APP)).then(function(results) {
      Session.set('getLeanixProjects', results);
    });
  });
  $('[data-toggle=popover]').popover();
  Session.set('editdefaultProjectManager', false);
  Session.set('editdefaultComplianceManager', false);
  Session.set('editmembers', false);
});

Template.projectSettings.events({
  'click #project-delete'(event) {
    event.preventDefault();
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const name = project.name;

    swal({
      title: 'Are you sure you want to delete project ' + name + '?',
      text: 'You will not be able to recover your project!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    },
    function () {
      const user = Meteor.user();
      Meteor.callAsync('Projects.Remove', project._id).then(function () {
        Notify.success('Project: ' + name + ' deleted');
        Meteor.callAsync('logEvent', user, name, 'projectDeleted');
        Router.go('projectList');
      }).catch(function (error) {
        if(error.error === 403){
          forceDeleteAndRedirect(project, name);
        }else{
          const message = IE + (error.reason || 'Project: ' + name + NOT_DELETED);
          Notify.danger(message);
          Meteor.callAsync('logEvent', user, message, 'projectDeleted');
        }
      });
    });
  },
  'click input[name="requireWhitelist"]': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    swal({
      title: 'Are you sure you want to update Enforce allow settings?',
      text: 'This will re-process all modules of this project to update status of licenses!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, update settings!'
    },
    function () {
      const project = Projects.findOne(Router.current().params.projectId);
      const requireWhitelist = !project.requireWhitelist;
      Meteor.callAsync('Projects.UpdateRequireWhitelist', project._id, requireWhitelist).then(function () {
        Meteor.callAsync('logEvent', user, 'Project ' + project.name + ' allow settings changed', 'projectSettingsUpdated');
        Notify.success('Project setting successfully changed');
        Meteor.callAsync('analyzeAllModules', project._id).then(function(data) {
          if (data === 0) {
            Notify.success('No modules was successfully analyzed. If you have some modules try to analyze them one by one');
          } else {
            Notify.success((data || 0) + ' modules was successfully analyzed.');
          }
        }).catch(function(error) {
          const msg = (error.reason || 'Service is not available');
          Notify.danger('Analysis error: ' + msg);
        });
      }).catch(function (error) {
        Notify.danger(error.message);
      });
    });
  },
  // No swal confirm here, unlike requireWhitelist: that toggle re-processes every
  // module immediately, this one has no effect until the next SARIF import. The
  // future-only semantics live in the persistent help text instead of a toast.
  'click input[name="autoCreateCweRisks"]': function (event) {
    // The switch must NOT move yet - the DOM is only ever driven by the stored
    // value, so a failed write cannot leave the UI out of step with the server.
    event.preventDefault();
    const instance = Template.instance();
    if (instance.autoCweSaving.get()) {
      return;
    }
    const user = Meteor.user();
    const project = Projects.findOne(Router.current().params.projectId);
    if (!project) {
      Notify.danger('Could not save the setting: the project is not loaded yet, please try again.');
      return;
    }
    const enabled = project.autoCreateCweRisks !== true;
    instance.autoCweSaving.set(true);
    Meteor.callAsync('Projects.UpdateAutoCreateCweRisks', project._id, enabled).then(function () {
      instance.autoCweSaving.set(false);
      Meteor.callAsync('logEvent', user, 'Project ' + project.name + ' SARIF risk creation ' +
        (enabled ? 'enabled' : 'disabled'), 'projectSettingsUpdated');
      if (enabled) {
        // info (3s), not success (1.5s): this is the sentence the user must read.
        // Kept to the one fact a toast has to carry on its own - that nothing happens
        // until the next import. The back-fill caveat lives in the persistent help
        // text beside the toggle, which is on screen while this toast shows.
        Notify.info('Saved. Risks appear after the next SARIF import.');
      } else {
        Notify.success('Saved. New SARIF imports will not create risks. Risks already created stay in the register.');
      }
    }).catch(function (error) {
      instance.autoCweSaving.set(false);
      const reason = error && error.reason;
      // String(): a non-string reason would make .replace throw inside the catch.
      const detail = reason && reason !== AUTO_CWE_INTERNAL_ERROR ? String(reason) : 'please try again';
      Notify.danger('Could not save the setting: ' + detail.replace(/\.$/, '') + '.');
    });
  },
  'click .edit-field': function (event) {
    event.preventDefault();
    let key = $(event.target).data('key');
    Session.set('edit' + key, true);
  },
  'click .hide-field': function (event) {
    event.preventDefault();
    let key = $(event.target).data('key');
    Session.set('edit' + key, false);
  },
  'click .action-propagate': function (event) {
    event.preventDefault();
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    $('#updateProjectForm').submit();
    const key = $(event.target).data('details');
    const multy = $(event.target).data('multy');
    let keyData;
    if (!multy) {
      keyData = $(event.target).next().find(OPTION_SELECTED).val();
    } else {
      keyData = _.map($(event.target).next().find(OPTION_SELECTED), function (element) {
        return $(element).val();
      });
    }
    Meteor.callAsync('propagateRelatedUsers', project._id, key, keyData).then(function(data) {
      Session.set('freezeModuleMsg', 'Module successfully updated!');
      Notify.success('Project ' + key + ' successfully propagated to ' + (data || 0) + ' modules!');
    }).catch(function(error) {
      const message = 'Error: ' + (error.reason || ' could not propagate settings');
      Notify.danger(message);
    });
  },
  'click .action-propagate-settings': function (event) {
    event.preventDefault();
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    $('#updateProjectForm').submit();
    const key = $(event.target).data('details');
    const multy = $(event.target).data('multy');
    let keyData;
    if (!multy) {
      keyData = $(event.target).next().find(OPTION_SELECTED).val();
    } else {
      keyData = _.map($(event.target).next().find(OPTION_SELECTED), function (element) {
        return $(element).val();
      });
    }
    Meteor.callAsync('propagateProjectSettings', project._id, key, keyData).then(function(data) {
      Session.set('freezeModuleMsg', 'Module successfully updated!');
      Notify.success('Project ' + key + ' successfully propagated to ' + (data || 0) + ' modules!');
    }).catch(function(error) {
      const message = 'Error: ' + (error.reason || ' could not propagate settings');
      Notify.danger(message);
    });
  },
  'click .force_delete': function (event) {
    event.preventDefault();
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const name = project.name;

    swal({
      title: 'Are you sure you want to delete project ' + name + ' and all modules?',
      text: 'You will not be able to recover your data!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    },
    function () {
      Meteor.callAsync('forceDeleteProject', project).then(function() {
        Notify.success('Project: ' + name + ' deleted');
        Meteor.setTimeout(()=>{
          Router.go('projectList');
        }, 100)
      }).catch(function(error) {
        const message = IE + (error.reason || 'Project: ' + name + NOT_DELETED);
        Notify.danger(message);
      });
    });
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
      confirmButtonText: 'Yes, update settings!'
    }, async function () {
      const user = Meteor.user();
      const project = Projects.findOne({_id: self._id}, {
        fields: {
          name: true,
          endoflifePolicy: true
        }
      });
      let endoflifePolicy = project.endoflifePolicy || {};
      endoflifePolicy.enabled = !(project && project.endoflifePolicy && project.endoflifePolicy.enabled);
      try {
        await Meteor.callAsync('Projects.UpdateEndoflifePolicy', project._id, endoflifePolicy);
        Meteor.callAsync('logEvent', user, 'Project end-of-life policy changed', 'projectEndoflifePolicyUpdated');
        Notify.success('Project end-of-life policy successfully changed');
      } catch (error) {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, error.message, 'projectEndoflifePolicyUpdated');
      }
    });
  },
  'click .action-upload-architecture': function (event) {
    event.preventDefault();
    const instance = Template.instance();
    const input = instance.find(ARCHITECTURE_FILE_INPUT);
    const button = event.currentTarget;
    if (!input) {
      return;
    }
    // No reliable cross-browser "cancel" event exists for <input type="file">.
    // Falling back to the window regaining focus (which happens whether the
    // native picker was cancelled or a file was chosen) to restore focus to
    // the trigger button. The 'change' handler below also restores focus
    // explicitly for the (reliable) file-selected case.
    window.addEventListener('focus', function restoreFocusOnCancel() {
      window.removeEventListener('focus', restoreFocusOnCancel);
      button.focus();
    }, {once: true});
    input.click();
  },
  'change .architecture-file-input': function (event) {
    const instance = Template.instance();
    const input = event.target;
    const file = input.files && input.files[0];
    // Reset immediately so re-selecting the identical file path still fires
    // a fresh 'change' event next time.
    input.value = '';

    const button = instance.find(ARCHITECTURE_UPLOAD_BUTTON);
    const restoreFocus = function () {
      // Defer until after Blaze has flushed the reactive re-render that
      // re-enables the button (removes the "disabled" attribute set while
      // architectureUploading was true) - a disabled button cannot receive
      // focus, so calling focus() synchronously here would silently no-op.
      Tracker.afterFlush(function () {
        if (button) {
          button.focus();
        }
      });
    };

    if (!file) {
      restoreFocus();
      return;
    }
    if (!isArchitectureFileExtensionValid(file.name)) {
      Notify.danger('Invalid file type. Please upload a Markdown (.md or .markdown) file.');
      restoreFocus();
      return;
    }
    if (!isArchitectureFileSizeValid(file.size)) {
      Notify.danger('File too large. The maximum allowed size is 100 KB.');
      restoreFocus();
      return;
    }

    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;

    swal({
      title: 'Update Application goals from file?',
      text: 'This will replace the current Application goals content with the uploaded file. Continue?',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#2a94a2',
      confirmButtonText: 'Yes, upload it!'
    }, function () {
      instance.architectureUploading.set(true);
      const reader = new FileReader();
      reader.onload = function (loadEvent) {
        const content = loadEvent.target.result;
        Meteor.callAsync('Projects.UpdateArchitecture', project._id, content).then(function () {
          instance.architectureUploading.set(false);
          Notify.success('Application goals updated from file.');
          restoreFocus();
        }).catch(function (error) {
          instance.architectureUploading.set(false);
          Notify.danger((error && error.reason) || ARCHITECTURE_GENERIC_ERROR);
          restoreFocus();
        });
      };
      reader.onerror = function () {
        instance.architectureUploading.set(false);
        Notify.danger(ARCHITECTURE_GENERIC_ERROR);
        restoreFocus();
      };
      reader.readAsText(file);
    });
  }
});

Template.projectSettings.helpers({
  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },
  // AC1: the button must be enabled under the SAME condition as the
  // "Application goals" textarea right next to it. Previously this checked
  // the COARSER, section-level 'project.general' 'w' permission, which
  // diverges from the field-level 'project.general.description' key that
  // actually governs the textarea's disabled state for roles that have write
  // access to some OTHER field under "general" (e.g. leanix for
  // account_admin, relatedUsers.* for portfolio_manager) while description
  // itself stays read-only for them - letting the button show enabled when
  // the field next to it is read-only, and for account_admin (who IS in
  // Projects.UpdateArchitecture's allowed-role list) actually letting them
  // write a field the permission model says they can't. Checking the exact
  // same field-level key the textarea's own hasFieldRight(...) call uses
  // closes that gap.
  architectureUploadDisabled: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const uploading = Template.instance().architectureUploading.get();
    return uploading || !UserExtUtils.hasAccessRight('project.general.description', 'w', project);
  },
  architectureUploadIconClass: function () {
    return Template.instance().architectureUploading.get() ? 'fa fa-spinner fa-spin' : 'fa fa-upload';
  },
  autoCweSaving: function () {
    return Template.instance().autoCweSaving.get();
  },
  // Same project resolution as architectureUploadDisabled above, plus the role
  // check the method itself performs, so the disabled state cannot promise a
  // write the server will refuse (designer concern #4).
  autoCweToggleDisabled: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    // 'project.quality', not 'project.general.name': the control sits on the
    // Quality tab, beside the SARIF test requirements it acts on. The role check
    // is ANDed in so the disabled state matches what the method will actually
    // allow - the shipped cantEditRequireWhitelist helper checks only a role and
    // its method checks only different ones, which is why that toggle is both
    // disabled for users the server would permit and enabled for ones it 403s.
    return Template.instance().autoCweSaving.get() ||
      !UserExtUtils.hasAccessRight('project.quality', 'w', project) ||
      !(companyId && Roles.userIsInRole(user, AUTO_CWE_ROLES, companyId));
  },
  // The webhooks publication sends rows only to these roles, so the tab is shown
  // only to them instead of an empty table for everyone else.
  canManageWebhooks: function () {
    const user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    return !!(companyId && Roles.userIsInRole(user, WEBHOOK_ADMIN_ROLES, companyId));
  },
  architectureUploadAriaAttrs: function () {
    return Template.instance().architectureUploading.get() ? {'aria-busy': 'true'} : {};
  },
  getProjects: function () {
    return Projects;
  },
  getProjectSchema: function () {
    return ProjectSchema;
  },
  getEndoflifeSchema() {
    return EndoflifePolicy;
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

  getProjectComponentEntrySchema() {
    return BWComponentEntrySchema;
  },

  getProjectLicenseEntrySchema() {
    return BWLicenseEntrySchema;
  },

  getProjectCveEntrySchema() {
    return BWCveEntrySchema;
  },

  getWhitelistedComponents: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const company = Session.get('company');
    let companyList = [];
    if (company) {
      companyList = company.componentConfig && company.componentConfig.whitelist || [];
    }
    let projectList = project.componentConfig && project.componentConfig.whitelist || [];
    companyList.map(function (elem) {
      elem.companyItem = true;
      return elem
    });
    return companyList.concat(projectList);
  },

  getBlacklistedComponents: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const company = Session.get('company');
    let companyList = [];
    if (company) {
      companyList = company.componentConfig && company.componentConfig.blacklist || [];
    }
    let projectList = project.componentConfig && project.componentConfig.blacklist || [];
    companyList.map(function (elem) {
      elem.companyItem = true;
      return elem
    });
    return companyList.concat(projectList);
  },

  getWhitelistedLicenses: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const company = Session.get('company');
    let companyList = [];
    if (company) {
      companyList = company.licenseConfig && company.licenseConfig.whitelist || [];
    }
    let projectList = project.licenseConfig && project.licenseConfig.whitelist || [];
    companyList.map(function (elem) {
      elem.companyItem = true;
      return elem
    });
    return companyList.concat(projectList);
  },

  getBlacklistedLicenses: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const company = Session.get('company');
    let companyList = [];
    if (company) {
      companyList = company.licenseConfig && company.licenseConfig.blacklist || [];
    }
    let projectList = project.licenseConfig && project.licenseConfig.blacklist || [];
    companyList.map(function (elem) {
      elem.companyItem = true;
      return elem
    });
    return companyList.concat(projectList);
  },

  getWhitelistedCve: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const company = Session.get('company');
    let companyList = [];
    if (company) {
      companyList = company.cveConfig && company.cveConfig.whitelist || [];
    }
    let projectList = project.cveConfig && project.cveConfig.whitelist || [];
    companyList.map(function (elem) {
      elem.companyItem = true;
      return elem
    });
    return companyList.concat(projectList);
  },

  getBlacklistedCve: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const company = Session.get('company');
    let companyList = [];
    if (company) {
      companyList = company.cveConfig && company.cveConfig.blacklist || [];
    }
    let projectList = project.cveConfig && project.cveConfig.blacklist || [];
    companyList.map(function (elem) {
      elem.companyItem = true;
      return elem
    });
    return companyList.concat(projectList);
  },
  endoflifePolicy: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    return project && project.endoflifePolicy || {}
  },
  getAlgorithmList: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    const project = current && current.moduleCount ? current : parent;
    const company = Session.get('company');
    let companyList = [];
    if (company) {
      companyList = company.algorithmsConfig || [];
    }
    let projectList = project && project.algorithmsConfig || [];
    companyList.map(function (elem) {
      elem.companyItem = true;
      return elem
    });
    return _.sortBy(companyList.concat(projectList),'key');
  },

  getFoundAlgorithmsList: function () {
    return Session.get('getFoundAlgorithmsList')
  },

  getAlgorithmSettingsList: function () {
    return Session.get('getAlgorithmSettingsList')
  },

  getQualitySettingsList: function () {
    return Session.get('getQualitySettingsList')
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
  cantEditRequireWhitelist: function () {
    const user = Meteor.user();
    return (user && !Roles.userIsInRole(user, ['compliance_manager'], user.profile.companyId)) ? 'disabled' : '';
  },
  getProject: function () {
    return Projects.findOne(Router.current().params.projectId)
  },

  getUsersManagers: function () {
    return Session.get('getUsersManagers');
  },

  getUsersComplianceManagers: function () {
    return Session.get('getUsersComplianceManagers');
  },

  getUsers: function () {
    return Session.get('getUsers');
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

  getCompanyTags: function () {
    return Session.get('getCompanyTags');
  },

  inProgressGetCompanyTags: function () {
    return !Session.get('getCompanyTags');
  },

  hasNoCompanyTags: function () {
    let tags = Session.get('getCompanyTags');
    return tags && tags.length === 0;
  }
});

AutoForm.hooks({
  updateProjectFormEndoflifeConfig: {
    onSubmit: function (insertDoc) {
      let self = this;
      const formContext = Template.currentData();
      insertDoc.enabled = true;
      Meteor.callAsync('Projects.UpdateEndoflifePolicy', formContext.docId, insertDoc).then(function () {
        const user = Meteor.user();
        Meteor.callAsync('logEvent', user, 'Project end-of-life policy changed', 'projectEndoflifePolicyUpdated');
        Notify.success('Project end-of-life policy successfully changed');
        self.done();
      }).catch(function (error) {
        console.log('Error in onSubmit()', error);
        Notify.danger(error.message || 'Submission failed');
        self.done(new Error('Submission failed'));
      });
      return false;
    },
    onError: function (formType, error) {
      if (error && error.message) {
        Notify.danger(error.message);
      }
    }
  },
  updateProjectForm: {
    before: {
      'update': function (doc) {
        this.event.preventDefault();
        const user = Meteor.user();
        if (this.currentDoc.leanix !== doc.$set.leanix && Session.get('leanix') && Session.get(LEANIX_APP)) {
          Meteor.callAsync('leanixProjectsUpdate', Session.get('leanix'), this.currentDoc, true);
          Meteor.callAsync('leanixProjectsUpdate', Session.get('leanix'), doc.$set, false,
            window.location.href.replace('/settings', ''), 'project');
        }
        Meteor.callAsync('logEvent', user, 'Project ' + this.currentDoc.name + ' general settings changed', 'projectSettingsUpdated');
        return doc;
      }
    },
    onSuccess: function () {
      Notify.success('Project settings changed!');
    },
    onError: function (formType, error) {
      console.log(error);
      // occured error is no validation error
      if (error.errorType === 'Meteor.Error') {
        Notify.danger('Internal Error! Project settings not changed.');
      }
    }
  }
});
