import {Meteor} from 'meteor/meteor';
import {moment} from 'meteor/momentjs:moment';
import {Template} from 'meteor/templating';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {RESOLVED_RISK_STATES} from '/imports/lib/schemas/riskSchema';

Template.risksPortfolioNew.onRendered(async function () {
  Session.set('requestInProgress',false)
  let timerId = Meteor.setInterval(function () {
    if(Session.get('modulesByProject')) {
      getData(true)
      Meteor.clearInterval(timerId);
    }
  }, 100)
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
    Session.set('getRiskSettingsListNew');
  }
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - 14);
  try {
    const data = await Meteor.callAsync('RiskProperties.Filter', {created: {$gte: daysAgo}});
    Session.set('getRiskSettingsListNew', _.sortBy((data ? data : []), 'created').reverse());
    Session.set('requestInProgress', false);
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (error) {
    Session.set('requestInProgress', false);
  }
}

Template.risksPortfolioNew.helpers({
  getReportData: function () {
    return Session.get('getRiskSettingsListNew')
  },
  getDocId: function () {
    return Router.current().params.query.moduleId || Router.current().params.query.projectId
  },
  getViewType: function () {
    return Router.current().params.query.moduleId  ? 'moduleCmpRisksSettings' : 'projCmpRisksSettings'
  },
  getStats: function () {
    const allData = Session.get('getRiskSettingsListNew') || []
    const sevenDaysAgo = moment().subtract(5, 'days');
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
