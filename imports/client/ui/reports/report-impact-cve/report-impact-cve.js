import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';
import reportImpactCveService from '/imports/lib/reports/reportImpactCveService';
import Projects from '/imports/lib/collections/projects';
import Vulnerability from '/imports/lib/component/Vulnerability';
import {Config} from '/imports/config';

const VULN_META = {
  url: Config.appUrl + 'vulnerability_lake',
  confidence: 'HIGH',
  type: 'ts-vl'
}

Template.reportImpactCve.onRendered(function () {
  Session.set('requestInProgress');
  Session.set('reportImpactCve');
  Session.set('currentCve');
});

Template.reportImpactCve.events = {
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportImpactCve');
    let report = reportImpactCveService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.cveDetails.name+'-cve-impact.pdf');
    }catch (error){
      console.log(error)
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  },
  'click .reset_view': function () {
    $('.form-inline').validate().resetForm();
    Session.set('currentCve')
    Session.set('reportImpactCve')
    $('#cveImpactForm').find('input').val('');
  },
  'submit #cveImpactForm': function (event) {
    event.preventDefault();
    Session.set('requestInProgress', true);
    let val = $(event.target).find('[name=currentCve]').val().trim();
    Session.set('currentCve', val)
    Meteor.callAsync('getImpactCve', val.toUpperCase()).then(function(data) {
      Session.set('requestInProgress', false);
      Session.set('reportImpactCve', data);
    })
  },
  'click .send_alert': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    Meteor.callAsync('notifyAboutCveImpact', user, Session.get('reportImpactCve')).then(function() {
      Notify.success('Notification about CVE impact sent');
    }).catch(function(error) {
      Notify.danger('Error: ' + (error.reason || ' could not send notification'));
    })
  }
};
Template.reportImpactCve.helpers({
  noData: function () {
    let data = Session.get('reportImpactCve');
    return data && data.list && data.list.length === 0  && !Session.get('requestInProgress')
  },
  getProject: function () {
    let data = Session.get('reportImpactCve');
    return data && data.list
  },
  cveDetails: function () {
    let data = Session.get('reportImpactCve');
    const details = data && data.cveDetails
    return new Vulnerability(getConfidenceDetails(details), details)
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  },
  beforeRequest: function () {
    return !Session.get('reportImpactCve') && !Session.get('requestInProgress')
  },
  currentCve: function () {
    return Session.get('currentCve')
  },
  isUnasigned: function () {
    return Projects.UNASSIGNED === this._id;
  },
  haveDescription: function (description) {
    return description && description.length > 0
  },
  actionRoute: function () {
    const path = this;
    return {
      route: 'projectModules',
      params: {
        projectId: path._id || Projects.UNASSIGNED
      }
    }
  }
});

function getConfidenceDetails(vuln) {
  const confidenceOrMeta = vuln.confidence ? {
    confidence: vuln.confidence,
    vendor: vuln.vendor,
    product: vuln.product
  } : VULN_META;
  return vuln.ecs ? vuln.ecs : confidenceOrMeta
}
