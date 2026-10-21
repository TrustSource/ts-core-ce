import {Meteor} from 'meteor/meteor';
import {moment} from 'meteor/momentjs:moment';
import {Template} from 'meteor/templating';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {RESOLVED_RISK_STATES} from '/imports/lib/schemas/riskSchema';


Template.risksPortfolioUnmitigated.onRendered(async function () {
  Session.set('requestInProgress',false)
  getData(true)
  Session.set('getUsers');
  this.autorun((c) => {
    const user = Meteor.user();
    if (!user) return;
    c.stop();
    Meteor.callAsync('getUsers', user).then(function(results) {
      let list = _.map(results, function (u) {
        return {label: u.profile.name, value: u._id}
      });
      Session.set('getUsers', list);
    });
  });

  this.autorun(() => {
    getData(true);
  });
});

async function getData(requestInProgress){
  if(requestInProgress){
    Session.set('requestInProgress', true);
    Session.set('getRiskSettingsListUnmitigated');
  }
  try {
    const data = await Meteor.callAsync('RiskProperties.Filter', {$and:[{'riskProperties.generalApproach': {$ne:'ignore'}},{
      $or: [
        { 'riskProperties.countermeasures': { $exists: false } },
        { 'riskProperties.countermeasures': { $size: 0 } }
      ]}]});
    Session.set('getRiskSettingsListUnmitigated', _.sortBy((data ? data : []), 'created').reverse());
    Session.set('requestInProgress', false);
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (error) {
    Session.set('requestInProgress', false);
  }
}

Template.risksPortfolioUnmitigated.helpers({
  getReportData: function () {
    return Session.get('getRiskSettingsListUnmitigated')
  },
  getDocId: function () {
    return Router.current().params.query.moduleId || Router.current().params.query.projectId
  },
  getViewType: function () {
    return Router.current().params.query.moduleId  ? 'moduleCmpRisksSettings' : 'projCmpRisksSettings'
  },
  getStats: function () {
    const allData = Session.get('getRiskSettingsListUnmitigated') || []
    const sevenDaysAgo = moment().subtract(7, 'days');
    const resolvedStates = RESOLVED_RISK_STATES;
    return {
      risks: allData.length,
      new: allData.filter(function (item) {
        return moment(item.created).isAfter(sevenDaysAgo)
      }).length,
      opened: allData.filter(function (item) {
        return resolvedStates.indexOf(item.riskProperties.state) === -1
      }).length,
      resolved: allData.filter(function (item) {
        return resolvedStates.indexOf(item.riskProperties.state) > -1
      }).length
    }
  }
});
