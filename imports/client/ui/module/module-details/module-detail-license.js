import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Utils from '/imports/lib/utils';
import Component from '/imports/lib/component/Component';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import Pluralize from 'pluralize';
import Company from '/imports/lib/company/Company';
import {Config} from '/imports/config';

function getOptimizedLicenseKey(key) {
  return key && key.split(/[.#:@/() ]/).join('') || 'unknown'
}

Template.moduleLicense.onRendered(function () {
  Session.set('moduleDetailFilter');
  Session.set('showDetails');
});

Template.moduleLicense.events({

  'click .expand-table': function (event) {
    event.preventDefault();
    const license = this;
    let details = Session.get('showDetails') || [];
    let isShowDetails = _.any(details,function (item) {
      return item === getOptimizedLicenseKey(license.getKey())
    });
    if(isShowDetails){
      details = _.reject(details,function (item) {
        return item === getOptimizedLicenseKey(license.getKey())
      });
    }else{
      details.push(getOptimizedLicenseKey(license.getKey()));
    }
    this.loadedComponents = 10;
    Session.set('showDetails', details);
    Session.set('loadingInProgress',true);
    Meteor.setTimeout(function () {
      Session.set('loadingInProgress',false);
      const panelEl = $('.panel-'+getOptimizedLicenseKey(license.getKey()));
      const icon = panelEl.find('i.ts-panel-toggle');
      const body = panelEl.find('.license-table-collapse');
      if(isShowDetails){
        icon.addClass('fa-chevron-right').removeClass('fa-chevron-down');
        panelEl.addClass('').removeClass('collapsed');
        body.slideUp(300);
      }else{
        icon.removeClass('fa-chevron-right').addClass('fa-chevron-down');
        panelEl.removeClass('').addClass('collapsed');
        body.slideDown(300);
      }
    },1);
  },
  'click input[name=licenses]': function (event) {
    const content = $(event.target).closest('.content');
    let selectedLicenses = [];
    content.find('input[name=licenses]:checked').each(function () {
      selectedLicenses.push(this.value);
    });
    Session.set('selectedLicenses', selectedLicenses);
  },
  'click .js-load-more': function (event) {
    event.preventDefault();
    let license = this;
    Session.set('loadingInProgress',true);
    this.loadedComponents = (this.loadedComponents||10) + 10;
    Meteor.setTimeout(function () {
      const panelEl = $('.panel-'+getOptimizedLicenseKey(license.getKey()));
      const bodyComponent = panelEl.find('.component-table-collapse');
      bodyComponent.show(0);
      Session.set('loadingInProgress',false);
    },300);
  }


});

Template.moduleLicense.helpers({
  getModuleLicenseOptions: function () {
    let params;
    if (Router.current().params.projectId) {
      params = {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId,
        key: this.getKey()
      };
    } else {
      params = {
        key: this.getKey()
      };
    }
    return params;

  },

  notOk: function () {
    return this.status !== 'ok';
  },

  getProblemDescription: function () {
    const item = this;
    if (item && item.getName()) {
      let components = [];
      if (item.data().components.length > 0) {
        components = _.uniq(_.map(item.data().components, function (e) {
          return e.componentKey;
        }));
      }
      // This text is pasted into a Jira/GitHub ticket. `status` is only ever
      // 'warnings' or 'violations' here (the notOk gate above excludes 'ok'), so
      // "resolve this <status>" never agreed with its subject; and with no
      // components recorded the component sentence has nothing to list.
      //
      // Both branches ask the same question, in the same words the component
      // twins use ("Please check whether this component is still needed"): the
      // two used to address the reader differently for no reason.
      return {
        text: 'License "'+ item.getName() +'" has status "' + item.status + '" \n'+
        (components.length
          ? 'Please check whether this license is still needed in '+ Pluralize('component', components.length, true) +
            ' and resolve the reported ' + item.status + '. \n' +
            'Components are: '+ components.join(', ') +'. \n'
          : 'Please check whether this license is still needed and resolve the reported ' + item.status + '. \n') +
        'Thank you for your support.',
        title: item.getName()+' - ' + item.status + ' (' + Config.name + ' generated task)'
      };
    }
  },

  module: function () {
    return Template.parentData(1)
  },

  hasJiraConnection: function () {
    const module = Template.parentData(1);
    const item = this;
    return _.find(module.jira, function (elem) {
      return elem.ecs === item.getKey()
    });
  },

  hasTfsConnection: function () {
    const module = Template.parentData(1);
    const item = this;
    return _.find(module.tfs, function (elem) {
      return elem.ecs === item.getKey()
    });
  },

  isUnknown: function () {
    return this.getKey() === 'unknown'
  },

  showDetails: function () {
    let license = this;
    let details = Session.get('showDetails') || [];
    return _.any(details,function (item) {
      return item === getOptimizedLicenseKey(license.getKey())
    }) || Session.get('showAll')
  },

  getLicenseComponents: function () {
    const components = this.data().components;
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    if (module && module._id) {
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company')
      const companyClass = new Company(company);
      const licenseComponents = _.uniq(_.map(components, function (component) {
        return component.componentKey
      }));
      const moduleComponents = _.filter(Session.get('moduleComponents'), function (moduleComponent) {
        return licenseComponents.indexOf(moduleComponent.key) > -1
      });
      let list =  _.map(moduleComponents, function (component) {
        return Utils.updateComponentStatus(module, project, companyClass, new Component(component), null)
      });
      this.componentsList = list;
      return (!Session.get('loadingInProgress')) && list.slice(0, this.loadedComponents||10)
    }
  },

  loading: function () {
    return Session.get('loadingInProgress');
  },

  hasMore: function () {
    let total = this.componentsList && this.componentsList.length;
    return (!Session.get('loadingInProgress')) && (this.loadedComponents || 10) < total
  },

  notWhitelisted: function () {
    let status = this.requireWhitelist;
    return status !== undefined && status === false
  },

  privateLicense: function () {
    return this.privateLicense
  },

  getOptimizedKey: function () {
    return getOptimizedLicenseKey(this.getKey())
  },

  getLabelForNotWhitelisted: function () {
    return 'Not allowed (but '+this.label+')'
  }

});
