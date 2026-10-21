import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {startGuideTour} from '/imports/client/ui/common/guide/guide-panel';
import Notify from '/imports/api/notify';
import RLocalStorage from 'meteor/simply:reactive-local-storage'

function startIntro() {
  if (startGuideTour('welcome')) {
    saveIntro();
  }
}

function saveIntro() {
  RLocalStorage.setItem('welcomeIntro', true);
  const user = Meteor.user();
  if (user) {
    let intro = user.intro || {}
    intro.welcome = true
    Meteor.callAsync('updateUserIntro', 'welcome', true).catch(function (error) {
      console.log('User intro.welcome save problem: ' + error);
    });
  }
}

function hideDemoProject() {
  RLocalStorage.setItem('demoProject', true);
  const user = Meteor.user();
  if (user) {
    Meteor.callAsync('updateUserIntro', 'demoProject', true).catch(function (error) {
      console.log('User intro.demoProject save problem: ' + error);
    }
    );
  }
}

Template.dashboard.events({
  'click .show-intro': function (event) {
    event.preventDefault();
    startIntro();
  },
  'click .generate-project': async function () {
    Session.set('generateInProgress',true);
    let user = Meteor.user();
    if(user){
      try {
        const result = await Meteor.callAsync('generateDemoData');
        Meteor.setTimeout(async function () {
          if (result && result.existing) {
            Notify.info('The company already has a demo project. You can find it under Projects.');
          } else {
            Notify.success('Demo project was successfully loaded. You can view Projects for more details');
          }
          Session.set('generateInProgress');
          hideDemoProject();
          await refreshAfterDemoMutation();
        },1000)
      } catch (error) {
        console.error(error);
        Session.set('generateInProgress');
        Notify.danger(error.reason || 'Could not load the demo project');
      }
    }
  },
  'click .remove-demo': async function () {
    Session.set('generateInProgress',true);
    let user = Meteor.user();
    if(user){
      try {
        await Meteor.callAsync('removeDemoData');
        Session.set('generateInProgress');
        Notify.success('Demo data has been removed.');
        await refreshAfterDemoMutation();
      } catch (error) {
        Session.set('generateInProgress');
        console.error(error);
        Notify.danger(error.reason || 'Could not remove the demo data');
      }
    }
  }
});

async function updateChartsData() {
  try {
    const data = await Meteor.callAsync('getModulesHistory');
    data.fetchDate = new Date();
    Session.set('modulesHistory', data);
  } catch (error) {
    console.error(error);
  }
}

async function refreshAfterDemoMutation() {
  try {
    const [company, modules] = await Promise.all([
      Meteor.callAsync('getCompanyCurrent'),
      Meteor.callAsync('modulesByProject', false, true)
    ]);
    if (company) Session.set('company', company);
    if (modules !== undefined) Session.set('modulesByProject', modules);
  } catch (error) {
    console.error(error);
  }
  updateChartsData();
}

Template.dashboard.onRendered(function () {
  // Initialize tooltips
  $('[data-toggle=tooltip]').tooltip();
  this.autorun(function () {
    if (!Session.get('modulesHistory')) {
      updateChartsData()
    }
  });
  const user = Meteor.user();
  if (!RLocalStorage.getItem('welcomeIntro') && user && (!user.intro || !user.intro.welcome)){
    startIntro();
  }
});
Template.dashboard.helpers({
  noGenerate: function () {
    return !Session.get('generateInProgress')
  },

  demoProject: function () {
    const modules = Session.get('modulesByProject');
    if (Array.isArray(modules) && modules.length === 0) return true;
    const user = Meteor.user();
    return !RLocalStorage.getItem('demoProject') && user && (!user.intro || !user.intro.demoProject);
  },

  hasDemoData: function () {
    const modules = Session.get('modulesByProject');
    return _.any(modules || [], function (m) { return m && m.demo; });
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  modulesLoaded: function () {
    return Array.isArray(Session.get('modulesByProject'));
  },

  hasModules: function () {
    const modules = Session.get('modulesByProject');
    return Array.isArray(modules) && modules.length > 0;
  }
});
