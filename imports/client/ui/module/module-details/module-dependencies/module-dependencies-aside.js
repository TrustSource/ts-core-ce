/* global document:false, swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {Roles} from 'meteor/alanning:roles';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {formatPath} from '/imports/client/ui/helpers/template-helpers';
import {pathLocation, pathLicenses} from '/imports/lib/analysis/pathLocation';
import {
  extractPathReason,
  findResolutionEntry,
  resolutionState
} from '/imports/client/ui/module/common/licenseResolution';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Messages from '/imports/lib/collections/messages';
import LogEvents from '/imports/lib/collections/logevents';
import ComponentModifications from '/imports/lib/collections/componentModifications';
import Utils from '/imports/lib/utils';
import Notify from '/imports/api/notify';
import Clipboard from 'clipboard';
import Company from '/imports/lib/company/Company';
import License from '/imports/lib/component/License';
import {escapeHtml} from '/imports/lib/html/tableCells';
import {Config} from '/imports/config';

const IN_PROGRESS = 'action-in-progress';
const ASIDE_CLASS = '.aside-section-content';
const NOT_ALLOWED = 'You are not allowed to change this settings!'
const ADDED_BY = 'added by component checkbox. By '
const BG_VIOLATIONS = 'bg-violations'
const BG_WARNINGS = 'bg-warnings'
const BG_OK = 'bg-ok'
const MESSAGE_CREATE = 'Messages.Create'
const COULD_NOT_SAVE = ' could not save comment!'
const COMMENT_SAVED = 'Comment successfully saved!'
const CHANGE_LIST = 'ComponentModifications.CreateChangesList'

function isLicenseSelected(module, componentKey, version, path, selectedLicense) {
  return module && module.isLicenseSelected &&
    module.isLicenseSelected(componentKey, version, pathLocation(path), selectedLicense);
}

function isUnchanged(module, componentKey, version, path) {
  return module && module.isComponentUnchanged && module.isComponentUnchanged(componentKey, version, pathLocation(path));
}

function isLooseCoupled(module, componentKey, version, path) {
  return module && module.isComponentLooseCoupled && module.isComponentLooseCoupled(componentKey, version, pathLocation(path));
}

function isComponentCots(module, componentKey, version) {
  return module && module.isComponentCots && module.isComponentCots(componentKey, version);
}

// The component this aside is showing. Read off the aside's own template
// instance rather than `this`, so a helper works at whatever {{#with}}/{{#each}}
// depth it is called from - parentData depth in this file has broken helpers
// more than once.
function currentComponentKey() {
  const instance = Template.instance();
  return (instance && instance.data && instance.data.componentKey) || Session.get('currentComponent') || '';
}

// BOTH roles, matching the server gate on Modules.ResolveComponentLicense.
// `add_legal_rule_resolved` below checks only 'manager' while its own template
// gate admits both, so a compliance manager silently hits "not allowed" there.
function canSetComponentLicense() {
  const user = Meteor.user();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) return false;
  return Roles.userIsInRole(user, ['compliance_manager', 'manager'], companyId);
}

Template.moduleDependenciesAside.onCreated(function () {
  let clipboard = new Clipboard('.copy-path-details');

  clipboard.on('success', function (e) {
    Notify.success('Path was successfully copied');
    e.clearSelection();
  });

  $('.ecs-dependencies-aside').tooltip({
    selector: '[data-toggle=tooltip]'
  });
});

Template.moduleDependenciesAside.onRendered(function () {
  $('#saveMessage').validate({
    rules: {
      status: {
        required: false
      },
      subject: {
        required: false
      },
      message: {
        required: true
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (formObject) {
      const form = $(formObject);
      const senderId = Meteor.user()._id;
      const projectId = Router.current().params.projectId;
      const moduleId = Router.current().params.moduleId;
      const message_type = form.find('[name=type]').val(); //'set_status'
      let status = '';
      if(message_type === 'status'){
        status = form.find('[name=status]').val();
      }
      const subject = '';
      const message = form.find('[name=message]').val();
      const componentKey = Session.get('currentComponent');
      const type = status? 'changeComponentStatus' : 'componentComment';
      $(formObject).parent().addClass(IN_PROGRESS);
      Meteor.callAsync(
        MESSAGE_CREATE,
        {senderId, projectId, moduleId, componentKey, status, subject, message, type}
      ).then(function() {
        Notify.success(COMMENT_SAVED);
      }).catch(function(error) {
        Notify.danger('Error: ' + (error.reason || COULD_NOT_SAVE));
      }).finally(function() {
        form[0].reset();
        Session.set('messageType');
        Meteor.setTimeout(function () {
          $(formObject).parent().removeClass(IN_PROGRESS);
        },1)
      });
    }
  });
  Session.set('messageType');
  Session.set('showAsideLogs')
});

Template.moduleDependenciesAside.events({
  'submit #saveMessage': function (event) {
    event.preventDefault();
  },

  'click .ecs-aside-close': function () {
    Session.set('currentComponent')
  },

  'click .section-expand': function (event) {
    const section = $(event.target).closest('.aside-section');
    const content = section.find(ASIDE_CLASS);
    content.slideToggle(300)
  },

  'click .check-unchanged': function (event) {
    // event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Template.parentData(3);
      const componentKey = Session.get('currentComponent');
      // const path = this.path;
      // const version = this.version;
      const arr = module.getUnchangedComponents();
      const originalData = _.clone(arr);
      const comment = ADDED_BY + ((user.profile && user.profile.name) ||
        (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)) + ', ' + now.toLocaleDateString();
      if (event.target.checked && !!isUnchanged(module, componentKey, '*', null) === false) {
        arr.push({key: componentKey, comment: comment});
        Meteor.callAsync(
          'updateCollection',
          'Modules',
          module._id,
          'componentConfig.unchanged',
          arr,
          true,
          originalData
        ).then(function() {
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
          Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
        });
      } else {
        let filteredArr = _.reject(arr, function (e) {
          return e.key === componentKey;
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync(
            'updateCollection',
            'Modules',
            module._id,
            'componentConfig.unchanged',
            filteredArr,
            true,
            originalData
          ).then(function() {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          });
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },

  'click .check-cots': function (event) {
    // event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Template.parentData(1);
      const componentKey = Session.get('currentComponent');
      // const path = this.path;
      // const version = this.version.getVersion();
      const arr = module.getCotsComponents();
      const originalData = _.clone(arr);
      const comment = ADDED_BY + ((user.profile && user.profile.name) ||
        (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)) + ', ' + now.toLocaleDateString();
      if (event.target.checked && !!isComponentCots(module, componentKey, null) === false) {
        arr.push({key: componentKey, comment: comment});
        Meteor.callAsync(
          'updateCollection',
          'Modules',
          module._id,
          'componentConfig.cots',
          arr,
          true,
          originalData
        ).then(function() {
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
          Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
        });
      } else {
        let filteredArr = _.reject(arr, function (e) {
          return e.key === componentKey;
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync(
            'updateCollection',
            'Modules',
            module._id,
            'componentConfig.cots',
            filteredArr,
            true,
            originalData
          ).then(function() {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          });
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },

  'click .check-loose': function (event) {
    // event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Template.parentData(1);
      const componentKey = Session.get('currentComponent');
      // const path = this.path;
      // const version = this.version;
      const arr = module.getLooseCoupledComponents();
      const originalData = _.clone(arr);
      const comment = ADDED_BY + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)) + ', ' + now.toLocaleDateString();
      if (event.target.checked && !!isLooseCoupled(module, componentKey, null, null) === false) {
        arr.push({key: componentKey, comment: comment});
        Meteor.callAsync(
          'updateCollection',
          'Modules',
          module._id,
          'componentConfig.looseCoupled',
          arr,
          true,
          originalData
        ).then(function() {
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
          Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
        });
      } else {
        let filteredArr = _.reject(arr, function (e) {
          return e.key === componentKey;
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync(
            'updateCollection',
            'Modules',
            module._id,
            'componentConfig.looseCoupled',
            filteredArr,
            true,
            originalData
          ).then(function() {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          });
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },

  'click .scroll-to': function (event) {
    event.preventDefault();
    let content = $('.ecs-aside-content');
    const scrollTop = content.scrollTop();
    let target = $(event.target).data('target');
    if(!target){
      target = $(event.target).parent().data('target');
    }
    const scrollTo = $('[data-id='+target+']');
    if(scrollTo.length > 0){
      let position = scrollTo.position();
      content.animate( {
        'scrollTop': (position.top + scrollTop - 45)
      }, 900, 'swing');
    }
  },

  'click .reset-component-status': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const senderId = user._id;
    const projectId = Router.current().params.projectId;
    const moduleId = Router.current().params.moduleId;
    const status = '';
    const subject = '';
    const message = 'Reset component status';
    const componentKey = Session.get('currentComponent');
    const type = 'resetComponentStatus';
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    Meteor.callAsync(
      MESSAGE_CREATE,
      {senderId, projectId, moduleId, componentKey, status, subject, message, type}
    ).then(function() {
      Notify.success(COMMENT_SAVED);
    }).catch(function(error) {
      Notify.danger('Error: ' + (error.reason || COULD_NOT_SAVE));
    }).finally(function() {
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    });
  },

  'click .set-status-to-ok': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const senderId = user._id;
    const projectId = Router.current().params.projectId;
    const moduleId = Router.current().params.moduleId;
    const subject = '';
    const message = 'Yes, I checked the version and I can confirm that this is an intended change.';
    const componentKey = Session.get('currentComponent');
    const type = 'changeComponentStatus';
    const status = 'ok';
    swal({
      title: message,
      showCancelButton: true,
      confirmButtonColor: '#2a94a2',
      confirmButtonText: 'Ok'
    }, function (reason) {
      if(reason === false) return false;
      $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
      Meteor.callAsync(
        MESSAGE_CREATE,
        {senderId, projectId, moduleId, componentKey, status, subject, message, type}
      ).then(function() {
        Notify.success(COMMENT_SAVED);
      }).catch(function(error) {
        Notify.danger('Error: ' + (error.reason || COULD_NOT_SAVE));
      }).finally(function() {
        Meteor.setTimeout(function () {
          $(ASIDE_CLASS).removeClass(IN_PROGRESS);
        },1)
      });
    });
  },

  'click .set-export-status-to-ok': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const senderId = user._id;
    const projectId = Router.current().params.projectId;
    const moduleId = Router.current().params.moduleId;
    const subject = '';
    const message = 'Yes, I checked the export control settings and I can confirm that this is an intended change.';
    const componentKey = Session.get('currentComponent');
    const type = 'changeComponentStatus';
    const status = 'ok';
    swal({
      title: message,
      showCancelButton: true,
      confirmButtonColor: '#2a94a2',
      confirmButtonText: 'Ok'
    }, function (reason) {
      if(reason === false) return false;
      $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
      Meteor.callAsync(
        MESSAGE_CREATE,
        {senderId, projectId, moduleId, componentKey, status, subject, message, type}
      ).then(function() {
        Notify.success(COMMENT_SAVED);
      }).catch(function(error) {
        Notify.danger('Error: ' + (error.reason || COULD_NOT_SAVE));
      }).finally(function() {
        Meteor.setTimeout(function () {
          $(ASIDE_CLASS).removeClass(IN_PROGRESS);
        },1)
      });
    });
  },

  'change .change-message-type': function (event) {
    event.preventDefault();
    Session.set('messageType',$(event.target).val())
  },

  'change .change-changes-url': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const val = $(event.target).val();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const params = {
        component:{
          key: this.component.key,
          version: this.version,
          paths: [pathLocation(this.path)],
          changesUrl: this.changesUrl
        },
        updates:{
          changesUrl: val
        },
        moduleId: Router.current().params.moduleId,
        moduleName: Modules.findOne(Router.current().params.moduleId).getName(),
        projectId: Router.current().params.projectId
      }
      this.changesUrl = val
      Meteor.callAsync(CHANGE_LIST, params).then(function() {
        Meteor.setTimeout(function () {
          $(ASIDE_CLASS).removeClass(IN_PROGRESS);
        },1)
      })
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },

  'change .change-modification-notice': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const val = $(event.target).val();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const params = {
        component:{
          key: this.component.key,
          version: this.version,
          paths: [pathLocation(this.path)],
          changesText: this.changesText
        },
        updates:{
          changesText: val
        },
        moduleId: Router.current().params.moduleId,
        moduleName: Modules.findOne(Router.current().params.moduleId).getName(),
        projectId: Router.current().params.projectId
      }
      this.changesText = val
      Meteor.callAsync(CHANGE_LIST, params).then(function() {
        Meteor.setTimeout(function () {
          $(ASIDE_CLASS).removeClass(IN_PROGRESS);
        },1)
      })
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },

  'change .change-purpose': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const val = $(event.target).val();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const params = {
        component:{
          key: this.component.key,
          version: this.version,
          paths: [pathLocation(this.path)],
          purpose: this.purpose
        },
        updates:{
          purpose: val
        },
        moduleId: Router.current().params.moduleId,
        moduleName: Modules.findOne(Router.current().params.moduleId).getName(),
        projectId: Router.current().params.projectId
      }
      this.purpose = val
      Meteor.callAsync(CHANGE_LIST, params).then(function() {
        Meteor.setTimeout(function () {
          $(ASIDE_CLASS).removeClass(IN_PROGRESS);
        },1)
      })
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },

  'click .add_constraint_resolved': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Template.parentData();
      const data = Template.currentData();
      const componentKey = data.componentKey;
      const constraint = this;
      const constraintKey = constraint.key;
      const arr = module.getCompletedObligations();
      const originalData = _.clone(arr);
      swal({
        title: 'Are you sure you want to resolve obligation ' + escapeHtml(constraint.name) + '? <br>' +
          '<textarea id=\'confirmationText\' class="form-control inner-t-5" rows="6"></textarea>',
        html: true,
        showCancelButton: true,
        confirmButtonColor: '#cf4747',
        confirmButtonText: 'Resolve obligation!'
      }, function (reason) {
        if(reason === false) return false;
        $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
        reason = document.getElementById('confirmationText').value;
        if(reason){
          const comment = (reason?reason:'NO REASON PROVIDED') + ' By ' + Utils.username() + ', ' + now.toLocaleDateString();
          arr.push({key: componentKey, obligationKey: constraintKey, comment: comment});
          Meteor.callAsync(
            'updateCollection',
            'Modules',
            module._id,
            'obligationConfig',
            arr,
            true,
            originalData
          ).then(function() {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          });
        }else{
          Notify.warn('You are not allowed to resolve obligation without reason!');
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
        }
      });
    }else{
      Notify.danger(NOT_ALLOWED);
    }
  },

  'click .remove_constraint_resolved': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Template.parentData();
      const constraint = this;
      const constraintKey = constraint.key;
      const data = Template.currentData();
      const componentKey = data.componentKey;
      const arr = module.getCompletedObligations();
      const originalData = _.clone(arr);
      const filteredArr = _.reject(arr, function (e) {
        return e.key === componentKey && e.obligationKey === constraintKey;
      });
      if (arr.length !== filteredArr.length) {
        Meteor.callAsync(
          'updateCollection',
          'Modules',
          module._id,
          'obligationConfig',
          filteredArr,
          true,
          originalData
        ).then(function() {
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
          Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
        });
      }else{
        const project = Projects.findOne({_id: Router.current().params.projectId});
        if(project){
          const arr = project.getCompletedObligations();
          const originalData = _.clone(arr);
          const filteredArr = _.reject(arr, function (e) {
            return e.key === componentKey && e.obligationKey === constraintKey;
          });
          if (arr.length !== filteredArr.length) {
            Meteor.callAsync(
              'updateCollection',
              'Projects',
              project._id,
              'obligationConfig',
              filteredArr,
              true,
              originalData
            ).then(function() {
              Meteor.setTimeout(function () {
                $(ASIDE_CLASS).removeClass(IN_PROGRESS);
              },1)
              Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
            });
          }else{
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Notify.danger('Obligation is resolved in module or projects settings!');
          }
        }else{
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
          Notify.danger('Obligation is resolved in module or projects settings!');
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },

  'click .add_legal_rule_resolved': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Template.parentData();
      const data = Template.currentData();
      const componentKey = data.componentKey;
      const rule = this;
      const ruleKey = rule.key;
      const arr = module.getCompletedLegalRules();
      const originalData = _.clone(arr);
      let title = 'Are you sure you want to accept risk?'
      let confirmButtonText = 'Accept risk!'
      let resolveRules = ['LS_1', 'LS_2', 'MOD_1', 'DIST_1', 'DIST_2']
      if(resolveRules.indexOf(ruleKey) > -1){
        title = 'Are you sure you want to resolve?'
        confirmButtonText = 'Resolve!'
      }
      swal({
        title: title,
        text: escapeHtml(rule.message) + '<br>' +
          '<textarea id=\'confirmationText\' class="form-control inner-t-5" rows="6"></textarea>',
        html: true,
        showCancelButton: true,
        confirmButtonColor: '#cf4747',
        confirmButtonText: confirmButtonText
      }, function (reason) {
        if(reason === false) return false;
        $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
        reason = document.getElementById('confirmationText').value;
        if(reason){
          const comment = (reason?reason:'NO REASON PROVIDED') + ' By ' + Utils.username() + ', ' + now.toLocaleDateString();
          arr.push({key: componentKey, ruleKey: ruleKey, comment: comment});
          Meteor.callAsync(
            'updateCollection',
            'Modules',
            module._id,
            'legalRulesConfig',
            arr,
            true,
            originalData
          ).then(function() {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          });
        }else{
          Notify.warn('You are not allowed to resolve this problem without reason!');
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
        }
      });
    }else{
      Notify.danger(NOT_ALLOWED);
    }
  },

  'click .remove_legal_rule_resolved': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Template.parentData();
      const rule = this;
      const ruleKey = rule.key;
      const data = Template.currentData();
      const componentKey = data.componentKey;
      const arr = module.getCompletedLegalRules();
      const originalData = _.clone(arr);
      const filteredArr = _.reject(arr, function (e) {
        return e.key === componentKey && e.ruleKey === ruleKey;
      });
      if (arr.length !== filteredArr.length) {
        Meteor.callAsync(
          'updateCollection',
          'Modules',
          module._id,
          'legalRulesConfig',
          filteredArr,
          true,
          originalData
        ).then(function() {
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
          Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
        });
      }else{
        Meteor.setTimeout(function () {
          $(ASIDE_CLASS).removeClass(IN_PROGRESS);
        },1)
        Notify.danger('Obligation is resolved in module settings!');
      }
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },

  'click .show_module_logs': function (event) {
    const template = Template.instance();
    event.preventDefault();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    Session.set('showAsideLogs',template.data.componentKey)
    Meteor.setTimeout(function () {
      $(ASIDE_CLASS).removeClass(IN_PROGRESS);
    },1)
  }
});

Template.moduleDependenciesAside.helpers({
  isInfrastructureModule: function () {
    const template = Template.instance();
    return template.data && template.data.isInfrastructureModule
  },
  getModuleId: function () {
    return Router.current().params.moduleId;
  },
  getModuleLinkedModules: function () {
    const moduleId = Router.current().params.moduleId;
    const module = moduleId && Modules.findOne(moduleId);
    return module && module.linkedModules;
  },
  getComponentForLinking: function () {
    const scan = Session.get('moduleLastScan');
    const componentKey = this.componentKey || Session.get('currentComponent');
    if (scan && scan.dependencies && componentKey) {
      function findDep(deps, key) {
        for (let i = 0; i < deps.length; i++) {
          if (deps[i].key === key) return deps[i];
          if (deps[i].dependencies) {
            const found = findDep(deps[i].dependencies, key);
            if (found) return found;
          }
        }
        return null;
      }
      return findDep(scan.dependencies, componentKey);
    }
    return null;
  },
  getLinkedModule: function () {
    const moduleId = Router.current().params.moduleId;
    const module = moduleId && Modules.findOne(moduleId);
    const linkedModules = module && module.linkedModules;
    const componentKey = this.getKey ? this.getKey() : (this.key || Session.get('currentComponent'));
    if (linkedModules && componentKey) {
      const found = linkedModules.find(function (item) {
        return item.key === componentKey;
      });
      if (found) {
        return Object.assign({}, found, {moduleId: moduleId});
      }
    }
    return null;
  },
  showAsideLogs: function () {
    const template = Template.instance();
    return Session.get('showAsideLogs') === template.data.componentKey
  },
  component: function () {
    let data = this;
    let componentItem = _.find(data.components,function (item) {
      return item.getKey() === data.componentKey
    });
    let component = _.clone(componentItem);
    if(component){
      const commits = component.getMonthlyCommits();
      if (commits && commits.length) {
        Meteor.setTimeout(function () {
          const elem = $('#sparkline-' + component.data()._id);
          elem.show();
          elem.find('span').sparkline(commits, {
            type: 'bar',
            height: 20,
            barColor: '#2a94a2'
          });
        },1)
      }
      component.status = componentItem.status;
      this.component = component;
      return component;
    }
  },

  componentStatus: function () {
    return this.status || ''
  },

  rootComponentKey: function () {
    return (this && this.getKey && this.getKey()) || (this && this.key) || '';
  },

  // Escapes the user-controlled path before splicing chevron markup between
  // segments - paths come from scans and could carry HTML. Shared with
  // the license-resolution confirmation dialog, which has to preview the very same strings.
  formatPath: formatPath,

  // Everything the manual license-resolution section needs, gathered ONCE per
  // component. Returns null when the component needs no control at all, so the
  // section simply does not render.
  //
  // Note this deliberately does NOT live inside the per-path {{#each}}: the
  // resolution is per (module, component key) and covers every path and every
  // version, so offering it per path would present N controls for one decision.
  licenseResolutionContext: function () {
    const component = this;
    const componentKey = currentComponentKey();
    const moduleId = Router.current().params.moduleId;
    if (!componentKey || !moduleId) return null;
    const module = Modules.findOne(moduleId, {fields: {componentConfig: 1}});
    if (!module) return null;

    const versions = (component && component.getVersions && component.getVersions()) || [];
    const paths = [];
    versions.forEach(function (version) {
      const data = version && version.data ? version.data() : version;
      ((data && data.paths) || []).forEach(function (item) {
        const licenses = (item && item.licenses) || [];
        paths.push({
          licenseCount: licenses.length,
          // `extractPathReason`, not an inline read: the reason lives on
          // `license.status`, while `licenseStatus` is the HELPER a few hundred
          // lines below in this same file. Reading the helper name as a field
          // returns undefined for every component and silently disables trigger
          // state (b) - which is the state the issue title describes.
          reason: extractPathReason(licenses),
          path: item,
          version: data && data.version
        });
      });
    });

    const ctx = {componentKey: componentKey, paths: paths};
    const licensesSelected = (module.componentConfig && module.componentConfig.licensesSelected) || [];
    if (resolutionState(ctx, licensesSelected) === 'none') return null;

    // `getModuleData` parks the current analysis under the module id, so the
    // "was this picked up?" check does not depend on parentData depth.
    const analysis = Session.get(moduleId);
    return {
      moduleId: moduleId,
      componentKey: componentKey,
      componentName: (component && component.getName && component.getName()) || componentKey,
      paths: paths,
      pathCount: paths.length,
      versionCount: versions.length,
      analysisDate: analysis && analysis.date
    };
  },

  // The root component picker already owns this component's license when it
  // actually renders - EVERY one of its gates has to hold, not just `root`. For
  // a role outside compliance_manager|manager it renders nothing, and manual license resolution has
  // to work there.
  //
  // `this.root` covers every component the analysis flagged as a root, not just
  // the lone root of a single-root module: a module with several roots has a
  // license to pick for each. It deliberately does NOT resolve the analysis
  // through `Modules.findOne(moduleId, {fields: {analysisId: 1}})` - that
  // projects a field the module document does not carry at top level and returns
  // a doc without the `analysis` decoration `getModuleData` puts on the route
  // context, so on the dependencies route (which does not subscribe to
  // `moduleAnalysis`) the lookup missed and the whole section vanished until the
  // user arrived from a route that had warmed the cache.
  //
  // This is also the gate the picker's own section carries in the template, so
  // exactly one of the two license sections exists at a time: gating it on the
  // bare `root` flag left an empty gavel panel next to the new section, and a
  // second element marked `data-id="aside-legal"` for the jump link to land on.
  rootPickerOwnsComponent: function () {
    if (!(this && this.root)) return false;
    // `shouldRender` inside rootComponentLicensePicker - without both it draws
    // nothing at all.
    const rootKey = (this.getKey && this.getKey()) || this.key || '';
    if (!rootKey || !Router.current().params.moduleId) return false;
    return canSetComponentLicense();
  },

  // Per-path pointer state. Both read the component key off the aside's own
  // template instance rather than walking parentData: these render at two
  // different depths (inside {{#with getSelectedLicense}} and inside the
  // no-licenses {{else}}), and parentData depth in this file is a standing bug
  // source.
  canSetComponentLicense: function () {
    return canSetComponentLicense();
  },

  pathResolutionKey: function () {
    const moduleId = Router.current().params.moduleId;
    const module = moduleId && Modules.findOne(moduleId, {fields: {componentConfig: 1}});
    const licensesSelected = (module && module.componentConfig && module.componentConfig.licensesSelected) || [];
    const entry = findResolutionEntry(licensesSelected, currentComponentKey());
    return entry ? entry.license : '';
  },

  getComponentPath: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    const version = this.data();
    const component = this.component.data();
    const changesUrl = ComponentModifications.findOne({
      'component.key': component.key,
      'component.version': version.version,
      'moduleId': Router.current().params.moduleId,
      'companyId': companyId,
      'type': 'changesUrl'
    }, {sort: {created: -1}, limit: 1})
    const purpose = ComponentModifications.findOne({
      'component.key': component.key,
      'component.version': version.version,
      'moduleId': Router.current().params.moduleId,
      'companyId': companyId,
      'type': 'purpose'
    }, {sort: {created: -1}, limit: 1})
    const changesText = ComponentModifications.findOne({
      'component.key': component.key,
      'component.version': version.version,
      'moduleId': Router.current().params.moduleId,
      'companyId': companyId,
      'type': 'changesText'
    }, {sort: {created: -1}, limit: 1})
    return _.map(version.paths, function (item, index) {
      return {
        path: item,
        options: item.options,
        component: component,
        version: version.version,
        changesUrl: changesUrl && changesUrl.value,
        changesText: changesText && changesText.value,
        purpose: purpose && purpose.value,
        path_index: index
      }
    })
  },

  viabilityStatus: function () {
    let module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.viabilityConfig && analysis.viabilityConfig.enabled){
      const component = Template.parentData(1);
      return component.getViabilityStatus(analysis);
    }else{
      return 'disabled'
    }
  },

  versioningMessage: function () {
    const module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.versioningConfig && analysis.versioningConfig.enabled) {
      const component = Template.parentData(1);
      const versioning = component.getVersioning();
      if (versioning) {
        return versioning.message || versioning.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  versioningStatus: function () {
    const module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.versioningConfig && analysis.versioningConfig.enabled) {
      const component = Template.parentData(1);
      const versioning = component.getVersioning();
      if (versioning) {
        return versioning.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  versioningIcon: function () {
    const module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.versioningConfig && analysis.versioningConfig.enabled) {
      const component = Template.parentData(1);
      const versioning = component.getVersioning();
      if(versioning){
        if (versioning.status === 'violations') {
          return 'fa-hourglass-end'
        }else if(versioning.status === 'warnings') {
          return 'fa-hourglass-half';
        }else if(versioning.status === 'ok') {
          return 'fa-hourglass-start';
        }
      }else{
         
        return 'fa-hourglass-o'
      }
    }else{
      return 'fa-hourglass-o'
    }
  },

  endoflifeIcon: function () {
    const module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.endoflifePolicy && analysis.endoflifePolicy.enabled) {
      const component = Template.parentData(1);
      const info = component.getEndoflife();
      if(info){
        if (info.status === 'violations') {
          return 'fa-hourglass-end'
        }else if(info.status === 'warnings') {
          return 'fa-hourglass-half';
        }else if(info.status === 'ok') {
          return 'fa-hourglass-start';
        }
      }else{
        return 'fa-hourglass-o'
      }
    }else{
      return 'fa-hourglass-o'
    }
  },

  endoflifeStatus: function () {
    const module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.endoflifePolicy && analysis.endoflifePolicy.enabled) {
      const component = Template.parentData(1);
      const info = component.getEndoflife();
      if (info) {
        return info.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  endoflifeMessage: function () {
    const module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.endoflifePolicy && analysis.endoflifePolicy.enabled) {
      const component = Template.parentData(1);
      const info = component.getEndoflife();
      if (info) {
        return info.message || info.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  encryptionMessage: function () {
    const module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.algorithmsConfig && analysis.algorithmsConfig.length) {
      const component = Template.parentData(1);
      const encryption = component.getEncryption();
      if (encryption) {
        return encryption.message || encryption.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  encryptionStatus: function () {
    const module = Template.parentData(3);
    const analysis = module && module.analysis && module.analysis[0];
    if(analysis && analysis.algorithmsConfig && analysis.algorithmsConfig.length) {
      const component = Template.parentData(1);
      const encryption = component.getEncryption();
      if (encryption) {
        return encryption.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  isDisabled: function (status) {
    return status === 'disabled'
  },

  getVersionDetails: function () {
    return Template.parentData(0).version;
  },

  getVersionLicenses: function () {
    const version = Template.parentData(1);
    let lakeLicenses = version.getLicenses(version.component.getDeclaredLicenses());
    return this.path.licenses ? this.path.licenses.map(license => {
      let oneLicense = lakeLicenses.find(lic => (lic.getKey() === license.key || lic.getName() === license.name));
      if(oneLicense){
        if(oneLicense.getName() && !license.name){
          license.name = oneLicense.getName()
        }
        if(oneLicense.getUrl() && !license.url){
          license.url = oneLicense.getUrl()
        }
      }
      if(!license.name){
        license.name = license.key
      }
      return new License(license, version)
    }) : []
  },

  getPathDetails: function () {
    return Template.parentData(0);
  },

  getModuleOptions: function () {
    return {
      moduleId:Router.current().params.moduleId,
      projectId:Router.current().params.projectId
    };
  },

  getModuleComponentOptions: function () {
    let params;
    let _id = this.data()._id
    if(!_id){
      _id = ReactiveMethod.call('Components.IdByKey', this.getKey())
      this.data()._id = _id
    }
    if (Router.current().params.projectId) {
      params = {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId,
        _id: _id
      };
    } else {
      params = {
        _id: _id
      };
    }
    return params;

  },

  getSelectedLicense: function (listLicenses) {
    const module = Template.parentData(4);
    const data = Template.parentData(0);
    // const path = data.path;
    // const version = data.version;
    const component = data.component;
    let selectedLicense = false;
    if(listLicenses.length > 1){
      listLicenses.forEach(function (license) {
        if(isLicenseSelected(module, component.key, null, null, license.getKey())){
          selectedLicense =  license;
        }
      });
      if(!selectedLicense){
        listLicenses = _.sortBy(listLicenses,'key');
        selectedLicense = listLicenses[0]
      }
    }else{
      listLicenses = _.sortBy(listLicenses,'key');
      selectedLicense = listLicenses[0]
    }
    return selectedLicense
  },

  getVersionSelectedLicense: function (listLicenses) {
    const module = Template.parentData(3);
    // const version = this.getVersion();
    const component = this.component;
    let selectedLicense = false;
    if(listLicenses.length > 1){
      listLicenses.forEach(function (license) {
        if(isLicenseSelected(module, component.getKey(), null, null, license.getKey())){
          selectedLicense =  license;
        }
      });
      if(!selectedLicense){
        listLicenses = _.sortBy(listLicenses,'key');
        selectedLicense = listLicenses[0]
      }
    }else{
      listLicenses = _.sortBy(listLicenses,'key');
      selectedLicense = listLicenses[0]
    }
    return selectedLicense
  },

  licenseStatus: function () {
    const company = Session.get('company')
    const companyClass = new Company(company);
    const project = Projects.findOne({_id: Router.current().params.projectId});
    const module = Template.parentData(5);
    const path = Template.parentData(1);
    const version = Template.parentData(0).version.data();
    const license = this.data();
    if (!!license && !!version && !!path && !!path.component) {
      let pathLicense = _.clone(_.find(pathLicenses(path.path), function (licenseItem) {
        return licenseItem.key === license.key || licenseItem.key === license.name
      }));
      if (pathLicense && pathLicense.status) {
        pathLicense.status.computedStatus = Utils.computedLicenseStatusDetails(module, project,
          companyClass, license.key, pathLicense.status);
        return pathLicense.status
      }
    }
  },

  isCveWhiteListedAnywhere: function () {
    const cveKey = this.name;
    const version = Template.parentData();
    // const versionName = version.getVersion();
    const componentKey = version.component.getKey();
    const company = Session.get('company')
    const companyClass = new Company(company);
    const project = Projects.findOne({_id: Router.current().params.projectId});
    const module = Template.parentData(4);
    return (companyClass && typeof companyClass.isCveWhitelisted === 'function' &&
        companyClass.isCveWhitelisted(cveKey, componentKey, null)) ||
      (project && typeof project.isCveWhitelisted === 'function' && project.isCveWhitelisted(cveKey, componentKey, null)) ||
      (module && typeof module.isCveWhitelisted === 'function' && module.isCveWhitelisted(cveKey, componentKey, null))
  },

  isConstraintResolvedAnywhere: function () {
    const constraint = this.key;
    const license = Template.parentData();
    const version = license.version;
    const componentKey = version.component.getKey();
    const project = Projects.findOne({_id: Router.current().params.projectId});
    const module = Template.parentData(6);
    return (project && typeof project.isConstraintResolved === 'function' &&
        project.isConstraintResolved(constraint)) ||
      module.isConstraintResolved(constraint, componentKey)
  },

  isLegalRuleResolvedAnywhere: function () {
    const ruleKey = this.key;
    const license = Template.parentData();
    const version = license.version;
    const componentKey = version.component.getKey();
    const module = Template.parentData(6);
    return module && module.isLegalRuleResolved(ruleKey, componentKey)
  },

  isLegalRuleResolvable: function () {
    const ruleKey = this.key;
    const notResolvable = ['CA_1','CA_2','CA_3','CA_4','IP_3','TS_1','TS_2'];
    return notResolvable.indexOf(ruleKey) === -1
  },

  isWhiteListed: function (computedStatus) {
    return computedStatus && computedStatus.label.indexOf('Whitelisted') > -1
  },

  isPrivateLicense: function (computedStatus) {
    return computedStatus && computedStatus.privateLicense
  },

  isAndLicensesCase: function (licenseName) {
    if(licenseName.indexOf('(') === 0 && licenseName.indexOf(')') === licenseName.length - 1){
      licenseName = licenseName.substring(1, licenseName.length-1);
    }
    const licenses = licenseName.indexOf(' AND ') > -1 ? licenseName.split(' AND ') : licenseName.split(' OR ');
    if(licenses && licenses.length > 1){
      return licenses
    }
    return false
  },

  getLicense: function (key) {
    const license = ReactiveMethod.call('getLicenseByNameOrKeyOrAlias',key);
    return license || false
  },

  isBlackListed: function (computedStatus) {
    return computedStatus && computedStatus.label.indexOf('Blacklisted') > -1
  },

  describeObligations: function (obligations) {
    if(obligations){
      return _.map(obligations.split('; '),function (obligation) {
        return Utils.translateObligations(obligation)
      })
    }
  },

  describeViolations: function (violations) {
    if(violations){
      return _.map(violations.split('; '),function (violation) {
        return Utils.translatePermitions(violation)
      })
    }
  },

  licenseIsOk: function (licenseStatus) {
    return !!licenseStatus && !licenseStatus.obligations && !licenseStatus.reason && !licenseStatus.violations &&
      !licenseStatus.resolvedViolations && !licenseStatus.resolvedObligations
  },

  notOk: function () {
    return this.status !== 'ok';
  },

  hasJiraConnection: function () {
    // Look the module up by route param, not Template.parentData(): at the
    // Tasks-section render depth the module sits at parentData(2), so the old
    // parentData(4) resolved to undefined and threw on module.jira.
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const item = this;
    if (!module) return;
    return _.find(module.jira, function (elem) {
      return elem.ecs === item.getKey()
    });
  },

  hasTfsConnection: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const item = this;
    if (!module) return;
    return _.find(module.tfs, function (elem) {
      return elem.ecs === item.getKey()
    });
  },

  hasGithubConnection: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const item = this;
    if (!module) return;
    return _.find(module.github, function (elem) {
      return elem.ecs === item.getKey()
    });
  },

  getProblemDescription: function () {
    const module = Template.parentData(2);
    const analysis = module && module.analysis && module.analysis[0];
    const component = this;
    if (typeof component.data === 'function') {
      const item = component.data();
      // Scanned components frequently carry only `key` and no `name`; requiring
      // `item.name` here left description undefined, which emptied the Copy details
      // clipboard text and made Create issue throw before opening its modal.
      const name = component.getName ? component.getName() : (item && (item.name || item.key));
      if (item && name) {
        const status = component.status;
        const reasons = [];
        if (component.getViabilityStatus(analysis) !== 'ok'){
          reasons.push('Viability problems')
        }
        let haveVulnerabilities = _.any(component.getVersions(),function (version) {
          return version.getVulnerabilities().length
        });
        if (haveVulnerabilities){
          reasons.push('Vulnerability problems')
        }
        let haveLicenseProblems = _.flatten(_.map(component.getVersions(),function (version) {
          return _.map(version.data().paths,function (path) {
            return _.map(path.licenses,function (license) {
              return license.status.status
            });
          });
        }));
        if (_.any(haveLicenseProblems,function (problem) {
          return problem === 'violations' || problem === 'warnings'})){
          let status = _.any(haveLicenseProblems,function (problem) {
            return problem === 'violations'
          });
          const text = 'License '+ (status ? 'violations' : 'warnings');
          reasons.push(text)
        }
        // One entry per path, not one per version: _.map over the versions returns
        // an array of arrays, and joining that renders the inner arrays with their
        // own commas ("/a/b,/a/c; /d").
        const paths = _.flatten(_.map(item.versions, function (e) {
          return _.map(e.paths, function (i) {
            return i.path
          });
        }));
        // This text is pasted into a Jira/GitHub ticket, so every sentence has to
        // stand on its own: drop the ones whose list came back empty rather than
        // emitting "This is due to ." or "The component is found at: .".
        return {
          text: 'Component "'+ name +'" has status "' + status + '" \n'+
          (reasons.length ? 'This is due to '+ reasons.join('; ') +'. \n' : '') +
          'Please check whether this component is still needed and resolve the reported ' + status + '. \n' +
          (paths.length ? 'The component is found at: '+ paths.join('; ') +'. \n' : '') +
          'Thank you for your support.',
          title: name +' - ' + status + ' (' + Config.name + ' generated task)'
        }
      }
    }
  },

  module: function () {
    // Passed as module=module to the jira/tfs/github link sub-templates. Resolve
    // it from the collection so it is never undefined (parentData(4) was here).
    return Modules.findOne({_id: Router.current().params.moduleId});
  },

  componentDetails: function () {
    return typeof this.data === 'function' && this.data()
  },

  getType: function () {
    let status = this.type;
    return status ? {
      key:status+'s',
      text:status[0].toUpperCase()+status.substr(1,status.length)
    }: null
  },
  unchangedStatus: function () {
    const module = Template.parentData(4);
    return isUnchanged(module, this.component.key, '*', null) ? 'checked' : false;
  },

  unchangedInformation: function () {
    const module = Template.parentData(4);
    return isUnchanged(module, this.component.key, '*', null)
  },

  looseCoupledStatus: function () {
    const module = Template.parentData(4);
    return isLooseCoupled(module, this.component.key, '*', null) ? 'checked' : false;
  },

  looseCoupledInformation: function () {
    const module = Template.parentData(4);
    return isLooseCoupled(module, this.component.key, '*', null)
  },

  isCommercial: function () {
    const license = this;
    return license.isCommercial();
  },
  cotsComponent: function () {
    const module = Template.parentData(4);
    const version = this.version;
    return isComponentCots(module, version.component.getKey(), version.getVersion()) ? 'checked' : false;
  },
  cotsInformation: function () {
    const module = Template.parentData(4);
    const version = this.version;
    return isComponentCots(module, version.component.getKey(), version.getVersion())
  },

  getVersionData: function () {
    return Template.parentData(1)
  },

  getModule: function () {
    return Template.parentData(4)
  },

  getProject: function () {
    return Projects.findOne({_id: Router.current().params.projectId})
  },

  getCompany: function () {
    const company = Session.get('company')
    return new Company(company)
  },

  getModule3: function () {
    return Template.parentData(3)
  },

  moreThanOneLicense: function (licenses) {
    return licenses.length >  1
  },

  getLogs: function () {
    let componentKey = this && ((this.getKey && this.getKey()) || this.key);
    if(componentKey){
      return LogEvents.find({'message' : {$regex : '.*'+Utils.escapeRegex(componentKey)+' '+'.*'}}, {sort: {date: -1}, limit: 10}).fetch()
    }
  },

  getLogType: function (object) {
    return object.typeLabel ? object.typeLabel : object.type
  },

  getMessages: function () {
    let componentKey = this && ((this.getKey && this.getKey()) || this.key);
    if(componentKey){
      return Messages.find({'componentKey' : componentKey}, {sort: {created: -1}, limit: 100}).fetch()
    }
  },

  timelineIcon : function(){
    return hasError(this) ? 'fa-exclamation' : 'fa-check'
  },

  timelineClass : function(){
    return hasError(this) ? BG_VIOLATIONS : 'bg-primary'
  },

  getUserNameLog: function () {
    const user = Meteor.users.findOne(this.userId);
    return  (this.userName || (user.profile && user.profile.name)
    || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email) || 'User')
  },

  messageIcon: function () {
    if (this.status){
      if (this.status === 'ok'){
        return 'fa-check'
      }
      if (this.status === 'warnings'){
        return 'fa-exclamation'
      }
      if (this.status === 'violations'){
        return 'fa-times'
      }
      if (this.status === 'whitelisted'){
        return 'fa-flag-checkered'
      }
      if (this.status === 'blacklisted'){
        return 'fa-ban'
      }
    }
    return 'fa-comment'
  },

  messageClass: function () {
    if (this.status){
      if (this.status === 'ok'){
        return BG_OK
      }
      if (this.status === 'warnings'){
        return BG_WARNINGS
      }
      if (this.status === 'violations'){
        return BG_VIOLATIONS
      }
      if (this.status === 'whitelisted'){
        return BG_OK
      }
      if (this.status === 'blacklisted'){
        return BG_VIOLATIONS
      }
    }
    return 'bg-primary'
  },

  isSetStatus: function () {
    return Session.get('messageType') === 'status'
  },

  getStatusDetails: function () {
    let label = this.label;
    let status = this.status;
    if(label && label !== 'OK' && label !== 'Violations' && label !== 'Warnings'){
      return {
        title:'Component status is updated',
        description:label,
        status:status
      }
    }else{
      return false
    }
  },

  isNotStatusOk: function (versioningMessage) {
    return versioningMessage !== 'ok'
  },

  isForcedStatusOk: function (versioningMessage) {
    return versioningMessage === 'Ok (Changed)'
  },

  getScanOptions: function (){
    return this.options
  },

  isDenied: function () {
    const company = Session.get('company');
    let self = this;
    if(company && company.blacklistedAlgorithms && company.blacklistedAlgorithms.length){
      return company.blacklistedAlgorithms.some(algorithm => {
        if(!algorithm.key || !self.algorithm){
          return false;
        }
        return algorithm.key.toLowerCase() === self.algorithm.toLowerCase();
      })
    }else{
      return false
    }
  }
});

function hasError(log) {
  return log.message.indexOf('Error') > -1
}
