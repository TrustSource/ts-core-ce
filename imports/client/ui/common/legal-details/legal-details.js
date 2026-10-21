/* global document:false, swal:false */
import {Template} from 'meteor/templating';
import _ from 'underscore';
import Modules from '/imports/lib/collections/modules'
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import {Roles} from 'meteor/alanning:roles';
import {$} from 'meteor/jquery';
import {Meteor} from 'meteor/meteor';
import Notify from '/imports/api/notify';
import {Session} from 'meteor/session';
import {escapeHtml} from '/imports/lib/html/tableCells';

const IN_PROGRESS = 'action-in-progress';
const ASIDE_CLASS = '.aside-section-content';
const NOT_ALLOWED = 'You are not allowed to change this settings!'

Template.legalDetails.helpers({
  describeObligations: function (obligations) {
    return _.map(obligations.split('; '),function (obligation) {
      return Utils.translateObligations(obligation)
    });
  },
  describeViolations: function (violations) {
    return _.map(violations.split('; '),function (violation) {
      return Utils.translatePermitions(violation)
    });
  },
  licenseIsOk: function () {
    return !!this && !this.obligations && !this.reason && !this.violations
  },
  computedStatus: function () {
    const template = Template.instance();
    const company = Session.get('company');
    const project = Projects.findOne({_id: template.data.options.projectId});
    const module = Modules.findOne({_id: template.data.options.moduleId});
    return Utils.computedLicenseStatusDetails(module, project, company, template.data.license, template.data.legal)
  },
  isWhiteListed: function (computedStatus) {
    return computedStatus && computedStatus.label.indexOf('Whitelisted') > -1
  },
  isBlackListed: function (computedStatus) {
    return computedStatus && computedStatus.label.indexOf('Blacklisted') > -1
  },
  isPrivateLicense: function (computedStatus) {
    return computedStatus && computedStatus.privateLicense
  },
  licenseName: function () {
    const result = Template.parentData();
    return result.license
  },
  getType: function () {
    let status = this.type;
    return status ? {
      key:status+'s',
      text:status[0].toUpperCase()+status.substr(1,status.length)
    }: null
  },
  isLegalRuleResolvable: function () {
    const ruleKey = this.key;
    const notResolvable = ['CA_1','CA_2','CA_3','CA_4','IP_3','TS_1','TS_2'];
    return notResolvable.indexOf(ruleKey) === -1
  },
  isLegalRuleResolvedAnywhere: function () {
    const template = Template.instance();
    const module = Modules.findOne({_id: template.data.options.moduleId});
    const ruleKey = this.key;
    const version = template.data.version;
    const componentKey = version && version.component && version.component.getKey();
    return module && module.isLegalRuleResolved(ruleKey, componentKey)
  },
  isConstraintResolvedAnywhere: function () {
    const template = Template.instance();
    const project = Projects.findOne({_id: template.data.options.projectId});
    const module = Modules.findOne({_id: template.data.options.moduleId});
    const constraint = this.key;
    const version = template.data.version;
    const componentKey = version && version.component && version.component.getKey();
    return (project && typeof project.isConstraintResolved === 'function' &&
        project.isConstraintResolved(constraint)) ||
      module.isConstraintResolved(constraint, componentKey)
  }
});

Template.legalDetails.events({

  'click .add_constraint_resolved': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const template = Template.instance();
      const module = Modules.findOne({_id: template.data.options.moduleId});
      const version = template.data.version;
      const componentKey = version && version.component && version.component.getKey();
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
          Meteor.callAsync('updateCollection', 'Modules', module._id, 'obligationConfig', arr, true, originalData).then(function () {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          }).catch(function(error) {
            console.error('updateCollection failed:', error);
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
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
      const template = Template.instance();
      const module = Modules.findOne({_id: template.data.options.moduleId});
      const version = template.data.version;
      const componentKey = version && version.component && version.component.getKey();
      const constraint = this;
      const constraintKey = constraint.key;
      const arr = module.getCompletedObligations();
      const originalData = _.clone(arr);
      const filteredArr = _.reject(arr, function (e) {
        return e.key === componentKey && e.obligationKey === constraintKey;
      });
      if (arr.length !== filteredArr.length) {
        Meteor.callAsync('updateCollection', 'Modules', module._id, 'obligationConfig', filteredArr, true, originalData
          , function () {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          });
      }else{
        const project = Projects.findOne({_id: template.data.options.projectId});
        if(project){
          const arr = project.getCompletedObligations();
          const originalData = _.clone(arr);
          const filteredArr = _.reject(arr, function (e) {
            return e.key === componentKey && e.obligationKey === constraintKey;
          });
          if (arr.length !== filteredArr.length) {
            Meteor.callAsync('updateCollection', 'Projects', project._id, 'obligationConfig', filteredArr, true, originalData
              , function () {
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
      const template = Template.instance();
      const module = Modules.findOne({_id: template.data.options.moduleId});
      const version = template.data.version;
      const componentKey = version && version.component && version.component.getKey();
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
        text: escapeHtml(rule.message) + ' <br>' +
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
          Meteor.callAsync('updateCollection', 'Modules', module._id, 'legalRulesConfig', arr, true, originalData).then(function () {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          }).catch(function(error) {
            console.error('updateCollection failed:', error);
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
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
      const template = Template.instance();
      const module = Modules.findOne({_id: template.data.options.moduleId});
      const version = template.data.version;
      const componentKey = version && version.component && version.component.getKey();
      const rule = this;
      const ruleKey = rule.key;
      const arr = module.getCompletedLegalRules();
      const originalData = _.clone(arr);
      const filteredArr = _.reject(arr, function (e) {
        return e.key === componentKey && e.ruleKey === ruleKey;
      });
      if (arr.length !== filteredArr.length) {
        Meteor.callAsync('updateCollection', 'Modules', module._id, 'legalRulesConfig', filteredArr, true, originalData
          , function () {
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
  }
});
