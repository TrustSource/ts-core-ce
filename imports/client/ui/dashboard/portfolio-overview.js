import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import Company from '/imports/lib/company/Company';

Template.portfolioOverview.events({
  'click #db-module-violation': function () {
    Session.set('moduleFilter', {ok: true, warnings: true});
    Router.go('projectList');
  },
  'click #db-module-warning': function () {
    Session.set('moduleFilter', {ok: true, violations: true});
    Router.go('projectList');
  },
  'click #db-module-ok': function () {
    Session.set('moduleFilter', {warnings: true, violations: true});
    Router.go('projectList');
  },
  'click #db-module-all': function () {
    Session.set('moduleFilter', {});
    Router.go('projectList');
  },
  'click #db-component-violation': function () {
    console.log('Component bar pressed: violations');
  },
  'click #db-component-warning': function () {
    console.log('Component bar pressed: warnings');
  },
  'click #db-component-ok': function () {
    console.log('Component bar pressed: ok');
  },
  'click #db-component-all': function () {
    console.log('Component bar pressed: all');
  }
});

Template.portfolioOverview.helpers({
  modulesStatus: function () {
    const company = Session.get('company')
    const companyClass = new Company(company);
    const companyStats = companyClass && companyClass.getCompanyStats();
    return companyStats && companyStats.getModuleSummary();
  }
});
