import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import {moment} from 'meteor/momentjs:moment';
import Company from '/imports/lib/company/Company';

function getCompanyStats() {
  const user = Meteor.user();
  if (user && user.profile && user.profile.companyId) {
    const company = Session.get('company')
    const companyClass = new Company(company);
    return companyClass && companyClass.getCompanyStats();
  }
  return null;
}

function getModuleHistory() {
  const modulesHistory = Session.get('modulesHistory');
  const maxAge = moment().add(-12, 'hours');

  if (modulesHistory && modulesHistory.fetchDate < maxAge.toDate()) {
    Session.set('modulesHistory', null);
    return null;
  }
  return modulesHistory;
}

Template.portfolioHistory.onRendered(function () {
  const options = {
    type: 'bar',
    barWidth: 7,
    enableTagOptions: true,
    height: '25px',
    // barColor: '#62cb31',
    negBarColor: '#53ac2a'
  };

  this.autorun(function () {
    const MAX_HISTORY = 11; // from server we get range 0..11
    const modulesHistory = Session.get('modulesHistory');
    const projHistory = [];
    const compHistory = [];
    const licHistory = [];
    for (let i = MAX_HISTORY; i >= 0; i--) {
      let hist = modulesHistory && modulesHistory.history[MAX_HISTORY - i];
      projHistory[i] = hist && hist.modules.total || 0;
      compHistory[i] = hist && hist.components.total || 0;
      licHistory[i] = hist && hist.licenses.total || 0;
    }
    const companyStats = getCompanyStats(); // add slot 13 from current statistics
    projHistory[MAX_HISTORY + 1] = companyStats && companyStats.modules.total || 0;
    compHistory[MAX_HISTORY + 1] = companyStats && companyStats.components.total || 0;
    licHistory[MAX_HISTORY + 1] = companyStats && companyStats.licenses.total || 0;

    // Sparkline bar chart data
    $('#db-history-modules').sparkline(projHistory, options);

    $('#db-history-components').sparkline(compHistory, options);

    $('#db-history-licenses').sparkline(licHistory, options);
  });
});

Template.portfolioHistory.helpers({
  historyTitle: function () {
    const modulesHistory = getModuleHistory();
    let unit = '';
    if (modulesHistory) {
      unit = modulesHistory.unit || '';
    }
    return `History for last 12 ${unit}`;
  }
});

Template.portfolioChanges.helpers({
  deltaTitle: function () {
    const modulesHistory = getModuleHistory();
    let unit = '';
    if (modulesHistory) {
      unit = modulesHistory.unit || '';
      unit = unit.replace(/s$/, ''); // trim trailing 's'
    }
    return `Δ since last ${unit}`;
  },
  deltaStatistics: function () {
    const modulesHistory = getModuleHistory();
    const result = {};
    if (modulesHistory) {
      const companyStats = getCompanyStats();
      const history = modulesHistory.history && modulesHistory.history[0];
      ['modules', 'components', 'licenses'].forEach(k => {
        let curr = companyStats && companyStats[k] && companyStats[k].total;
        let old = history && history[k] && history[k].total || 0;
        result[k] = curr - old;
      });
    }
    return result;
  }
});
