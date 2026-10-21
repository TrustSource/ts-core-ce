import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Roles} from 'meteor/alanning:roles';

const IN_PROGRESS = 'action-in-progress';
const ASIDE_CLASS = '.aside-section-content';
const COTS_CONFIG = 'componentConfig.cots'

Template.cotsComponentCommercialTerms.helpers({
  commercialTerms: function () {
    return this.cotsInformation && this.cotsInformation.commercialTerms
  },
  compare: function (a, b) {
    return a === b
  },
  managerUser: function () {
    let user = Meteor.user();
    return Roles.userIsInRole(user, ['manager','compliance_manager'], user.profile.companyId)
  }
});

Template.cotsComponentCommercialTerms.events({
  'click [name="commercialTerms.RS"]': function (event) {
    const newVal = event.target.value;
    const module = this.module;
    const version = this.version.getVersion();
    const componentKey = this.version.component.getKey();
    if (module) {
      $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
      const arr = module.getCotsComponents();
      const originalData = _.clone(arr);
      let entry = arr.find(function (item) {
        return item.key === componentKey && item.version === version
      });
      if(entry){
        if(!entry.commercialTerms){
          entry.commercialTerms = {}
        }
        entry.commercialTerms['RS'] = newVal;
        Meteor.callAsync('updateCollection', 'Modules', module._id, COTS_CONFIG, arr, true, originalData, function () {
          $(event.target).closest(ASIDE_CLASS).removeClass(IN_PROGRESS);
        });
      }
    }
  },
  'click [name="commercialTerms.D"]': function (event) {
    const newVal = event.target.value;
    const module = this.module;
    const version = this.version.getVersion();
    const componentKey = this.version.component.getKey();
    if (module) {
      $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
      const arr = module.getCotsComponents();
      const originalData = _.clone(arr);
      let entry = arr.find(function (item) {
        return item.key === componentKey && item.version === version
      });
      if(entry){
        if(!entry.commercialTerms){
          entry.commercialTerms = {}
        }
        entry.commercialTerms['D'] = newVal;
        Meteor.callAsync('updateCollection', 'Modules', module._id, COTS_CONFIG, arr, true, originalData, function () {
          $(event.target).closest(ASIDE_CLASS).removeClass(IN_PROGRESS);
        });
      }
    }
  },
  'click [name="commercialTerms.SA"]': function (event) {
    const newVal = event.target.value;
    const module = this.module;
    const version = this.version.getVersion();
    const componentKey = this.version.component.getKey();
    if (module) {
      $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
      const arr = module.getCotsComponents();
      const originalData = _.clone(arr);
      let entry = arr.find(function (item) {
        return item.key === componentKey && item.version === version
      });
      if(entry){
        if(!entry.commercialTerms){
          entry.commercialTerms = {}
        }
        entry.commercialTerms['SA'] = newVal;
        Meteor.callAsync('updateCollection', 'Modules', module._id, COTS_CONFIG, arr, true, originalData, function () {
          $(event.target).closest(ASIDE_CLASS).removeClass(IN_PROGRESS);
        });
      }
    }
  },
  'click [name="commercialTerms.M"]': function (event) {
    const newVal = event.target.value;
    const module = this.module;
    const version = this.version.getVersion();
    const componentKey = this.version.component.getKey();
    if (module) {
      $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
      const arr = module.getCotsComponents();
      const originalData = _.clone(arr);
      let entry = arr.find(function (item) {
        return item.key === componentKey && item.version === version
      });
      if(entry){
        if(!entry.commercialTerms){
          entry.commercialTerms = {}
        }
        entry.commercialTerms['M'] = newVal;
        Meteor.callAsync('updateCollection', 'Modules', module._id, COTS_CONFIG, arr, true, originalData, function () {
          $(event.target).closest(ASIDE_CLASS).removeClass(IN_PROGRESS);
        });
      }
    }
  }
});
