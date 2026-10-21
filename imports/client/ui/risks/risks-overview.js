import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import Projects from '/imports/lib/collections/projects';

Template.risksOverview.onCreated(function () {
  this.hasAnyRisks = new ReactiveVar(false);
  this.hasRisksLoaded = new ReactiveVar(false);

  // Opened as the first page, this runs before the login has resumed and the call
  // is refused; wait for the user instead.
  this.autorun((computation) => {
    if (Meteor.loggingIn() || !Meteor.userId()) {
      return;
    }
    computation.stop();
    Meteor.callAsync('RiskProperties.Filter', {})
      .then((data) => {
        this.hasAnyRisks.set(Array.isArray(data) && data.length > 0);
        this.hasRisksLoaded.set(true);
      })
      .catch(() => {
        this.hasAnyRisks.set(false);
        this.hasRisksLoaded.set(true);
      });
  });
});

Template.risksOverview.onRendered(function () {
  let timerId = Meteor.setInterval(function () {
    if(Session.get('modulesByProject')) {
      let result = Projects.findMapped();
      Session.set('companyProjects',result);
      Meteor.clearInterval(timerId);
    }
  }, 100)
});

Template.risksOverview.helpers({
  getRiskQueryParams: function () {
    let params = {}
    if(Router.current().params.query.projectId){
      params.projectId = Router.current().params.query.projectId
    }
    if(Router.current().params.query.moduleId){
      params.moduleId = Router.current().params.query.moduleId
    }
    return params
  },
  hasRisksLoaded: function () {
    return Template.instance().hasRisksLoaded.get();
  },
  hasAnyRisks: function () {
    return Template.instance().hasAnyRisks.get();
  }
});
