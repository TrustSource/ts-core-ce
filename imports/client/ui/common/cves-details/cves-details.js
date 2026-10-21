/* global document:false, swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import Vulnerability from '/imports/lib/component/Vulnerability';
import Modules from '/imports/lib/collections/modules';
import {$} from 'meteor/jquery';
import Utils from '/imports/lib/utils';
import Notify from '/imports/api/notify';
import {escapeHtml} from '/imports/lib/html/tableCells';
import {Config} from '/imports/config';

const IN_PROGRESS = 'action-in-progress';
const ASIDE_CLASS = '.aside-section-content';
const NOT_ALLOWED = 'You are not allowed to change this settings!'
const CVE_WHITELIST = 'cveConfig.whitelist'
const SUCESSFULLY_UPDATED = 'Successfully updated'
const VULN_META = {
  url: Config.appUrl + 'vulnerability_lake',
  confidence: 'HIGH',
  type: 'ts-vl'
}

const muteVariants = [
  {
    value: '1',
    label: 'False positive, not applicable to us'
  },{
    value: '2',
    label: 'Vulnerable code not in use'
  },{
    value: '3',
    label: 'Risk is tolerable, won\'t fix'
  },{
    value: '4',
    label: 'Fix is about to be implemented'
  },{
    value: '5',
    label: 'Fix has been provided'
  }
]

Template.cvesDetails.onCreated(function () {
  let vulns = mapVulns((this.data.mappedVulnsData ? this.data.mappedVulnsData : []), this.data)
  vulns = _.sortBy(_.sortBy(vulns, function(vuln){
    return +vuln.getScore()
  }).reverse(), function(vuln){
    return +vuln.getConfidence()
  })
  let mappedVulns = new ReactiveVar(vulns);
  let requestInProgress = new ReactiveVar();
  this.mappedVulns = mappedVulns;
  this.requestInProgress = requestInProgress;
  const current = Session.get('confidenceMinScore')
  if(!current){
    Session.set('confidenceMinScore', '3')
  }
  Session.set('confidenceFiltered', false)
});

Template.cvesDetails.helpers({
  cellClass: function () {
    const template = Template.instance();
    return template.data.cellClass
  },
  hideConfidenceDetails: function () {
    const template = Template.instance();
    return template.data.hideConfidenceDetails
  },
  getRef: function () {
    const vulnerability = this;
    return vulnerability.getLink() || Router.url('vlCveByName', null, {query:{filter:  JSON.stringify({cve: vulnerability.getName()})}});
  },
  hasVulns: function () {
    return this.vulns && this.vulns.length
  },
  vulnsFiltered: function () {
    const data = Template.currentData();
    const list = data.vulns
    const minConf = Session.get('confidenceMinScore')
    const countBefore = list && list.length
    const listAfter =  minConf && list ? list.filter((vuln)=>{
      return vuln.getConfidenceScore() >= +minConf
    }): list
    const countAfter = listAfter.length
    Session.set('confidenceFiltered', countBefore !== countAfter)
    return listAfter
  },
  mappedVulns: function () {
    const template = Template.instance();
    const list = template.mappedVulns.get()
    const minConf = Session.get('confidenceMinScore')
    const countBefore = list && list.length
    const listAfter =  minConf && list ? list.filter((vuln)=>{
      return vuln.getConfidenceScore() >= +minConf
    }): list
    const countAfter = listAfter && listAfter.length
    Session.set('confidenceFiltered', countBefore !== countAfter)
    return listAfter
  },
  confidenceFiltered: function () {
    return Session.get('confidenceFiltered')
  },
  requestInProgress: function () {
    const template = Template.instance();
    return template.requestInProgress.get()
  },
  parseVector: function (vector) {
    let parts = vector.split('/')
    if(parts[0].indexOf('CVSS') !== 0){
      parts.unshift('CVSS:2.0');
    }
    return parts.join(' - ')
  },
  confidenceVariants: function () {
    return confidenceVariants
  },
  confidenceCurrent: function () {
    const list = confidenceVariants
    const current = Session.get('confidenceMinScore')
    const item = list.find((score) => {
      return score.value == current
    })
    return item && item.label || 'Click to set'
  },
  confidenceMinScore: function () {
    return Session.get('confidenceMinScore')
  },
  allowMute: function () {
    const template = Template.instance();
    return template.data.allowMute
  },
  hideTitle: function () {
    const template = Template.instance();
    return template.data.hideTitle
  },
  isCveWhiteListedAnywhere: function () {
    const template = Template.instance();
    const current = Template.currentData();
    if(current.vuln){
      const cveKey = current.vuln.name;
      // const versionName = current.version && current.version[0];
      const componentKey = template.data.componentKey;
      const company = template.data.company;
      const project = template.data.project;
      const module = template.data.module;
      return isCveWhiteListed(module, cveKey, componentKey, null) ||
        isCveWhiteListed(project, cveKey, componentKey, null) ||
        isCveWhiteListed(company, cveKey, componentKey, null)
    }
    return false
  },
  getWhitelistEntry: function () {
    const current = Template.currentData();
    if(current && current.vuln && current.vuln.isWhitelisted){
      const cveKey = current.vuln.name;
      const template = Template.instance();
      // Try template data first (module detail pages)
      const module = template.data.module;
      const project = template.data.project;
      const company = template.data.company;
      const componentKey = template.data.componentKey;
      let entry = isCveWhiteListed(module, cveKey, componentKey, null) ||
        isCveWhiteListed(project, cveKey, componentKey, null) ||
        isCveWhiteListed(company, cveKey, componentKey, null);
      if(entry) return entry;
      // Fallback: search report session data (report pages)
      const report = Session.get('reportProjectComponents');
      if(report && report.modules){
        for(const mod of report.modules){
          entry = isCveWhiteListed(mod, cveKey);
          if(entry) return entry;
        }
        entry = isCveWhiteListed(report.project, cveKey);
        if(entry) return entry;
      }
      return current.vuln.isWhitelisted;
    }
    return false;
  },
  getItemIndex: function (index) {
    return index + 1
  }
});

function isCveWhiteListed(module, cveKey, key, version, path ) {
  const array = module && module.cveConfig && module.cveConfig.whitelist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
}

const confidenceVariants = [{
  value: '5',
  label: 'High only'
},{
  value: '4',
  label: 'Medium +'
},{
  value: '1',
  label: 'All'
}]

function mapVulns(cves, self){
  let vulns = [];
  cves.forEach(function (cveDetails) {
    const impact = Utils.groupedImpactVersions(cveDetails.impact)
    let analisedVulnExtra;
    if(self && self.vulns && self.vulns.length){
      const analisedVuln = self.vulns.find((item)=>{
        return item.vuln.name === cveDetails.cve_id
      })
      analisedVulnExtra = analisedVuln && analisedVuln.vuln
    }
    vulns.push(new Vulnerability(getConfidence(self.vulns, cveDetails.cve_id), {
      cwe: true,
      cvssScore: (analisedVulnExtra && analisedVulnExtra.cvssScore) || cveDetails.cvssScore,
      weakness: cveDetails.weakness,
      impact,
      description: cveDetails.description,
      lastmodified: cveDetails.lastmodified,
      references: cveDetails.references,
      name: cveDetails.cve_id,
      cisa: cveDetails.cisa,
      link: (analisedVulnExtra && analisedVulnExtra.link) || cveDetails.link,
      environmental: (analisedVulnExtra && analisedVulnExtra.environmental) || cveDetails.environmental,
      baseScore: (analisedVulnExtra && analisedVulnExtra.baseScore) || cveDetails.baseScore,
      vectorString: (analisedVulnExtra && analisedVulnExtra.vectorString) || cveDetails.vectorString,
      cvssVersion: (analisedVulnExtra && analisedVulnExtra.cvssVersion) || cveDetails.cvssVersion,
      isWhitelisted: getWhitelisted(self.vulns, cveDetails.cve_id)
    }));
  });
  return vulns
}

const getWhitelisted = function (vulns, cveId){
  const cve = vulns.find((item)=>{
    return item.vuln.name === cveId
  })
  if(cve && cve.vuln && cve.vuln.isWhitelisted){
    const report = Session.get('reportProjectComponents')
    if(report && report.modules){
      for(const module of report.modules){
        const entry = isCveWhiteListed(module, cveId)
        if(entry) return entry
      }
      const entry = isCveWhiteListed(report.project, cveId)
      if(entry) return entry
    }
    return cve.vuln.isWhitelisted
  }
  return false
}

Template.cvesDetails.events({
  'click .change_confidence': function (event) {
    event.preventDefault();
    const value = $(event.target).attr('data-value');
    Session.set('confidenceMinScore', value)
  },
  'click .less_details': function (event) {
    event.preventDefault();
    const template = Template.instance();
    template.mappedVulns.set(null)
  },
  'click .get_details': function (event) {
    event.preventDefault();
    const self = this;
    const template = Template.instance();
    template.requestInProgress.set(true)
    const cveIds = self.vulns.map(function (vuln){
      return vuln.vuln.name
    })
    Meteor.callAsync('tsVulnerabilityCveDetails', {cves: cveIds}).then(function(data) {
      if(data && data.data && data.data.cves){
        const vulns = mapVulns(data.data.cves, self)
        template.mappedVulns.set(_.sortBy(_.sortBy(vulns, function(vuln){
          return +vuln.getScore()
        }).reverse(), function(vuln){
          return +vuln.getConfidence()
        }))
      }
      template.requestInProgress.set(false)
    }).catch(function(error) {
      console.error('tsVulnerabilityCveDetails failed:', error);
      template.requestInProgress.set(false)
    })
  },
  'click .add_cve_whitelist_single': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const template = Template.instance();
      const current = this;
      const cveKey = current.vuln.name;
      // const versionName = current.version && current.version[0];
      const componentKey = template.data.componentKey;
      const module = template.data.module;
      const arr = module.cveConfig && module.cveConfig.whitelist || [];
      const originalData = _.clone(arr);
      swal({
        title: 'Please confirm you want to discard the vulnerability alert for ' + escapeHtml(cveKey) + ' in this project/module.',
        text: 'Please give a reason for others to understand, why you think this alert may be omitted: <br>' +
          '<textarea id=\'confirmationText\' class="form-control inner-t-5" rows="6"></textarea>',
        html: true,
        showCancelButton: true,
        confirmButtonColor: '#cf4747',
        confirmButtonText: 'Mute for this module!'
      }, function (reason) {
        if(reason === false) return false;
        reason = document.getElementById('confirmationText').value;
        if(reason){
          const comment = (reason?reason:'NO REASON PROVIDED') + ' By ' + Utils.username() + ', ' + now.toLocaleDateString();
          arr.push({key: componentKey, comment: comment, cveKey:cveKey});
          Meteor.callAsync('updateCollection', 'Modules', module._id, CVE_WHITELIST, arr, true, originalData, function () {
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          });
          Notify.success(SUCESSFULLY_UPDATED);
        }else{
          Notify.warn('You are not allowed to mute vulnerability without reason!');
        }
      });
    }else{
      Notify.danger(NOT_ALLOWED);
    }
  },
  'click .add_cve_whitelist_fast_single': function (event) {
    event.preventDefault();
    const value = $(event.target).attr('data-value');
    const reason = muteVariants.find((variant)=>variant.value === value)
    const user = Meteor.user();
    const now = new Date();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const template = Template.instance();
      const current = this;
      const cveKey = current.vuln.name;
      // const versionName = current.version && current.version[0];
      const componentKey = template.data.componentKey;
      const module = template.data.module;
      const arr = module.cveConfig && module.cveConfig.whitelist || [];
      const originalData = _.clone(arr);
      const comment = (reason?reason.label:'NO REASON PROVIDED') + ' By ' + Utils.username() + ', ' + now.toLocaleDateString();
      arr.push({key: componentKey, comment: comment, cveKey:cveKey});
      Meteor.callAsync('updateCollection', 'Modules', module._id, CVE_WHITELIST, arr, true, originalData, function () {
        Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
        Notify.success(SUCESSFULLY_UPDATED);
      });
    }else{
      Notify.danger(NOT_ALLOWED);
    }
  },
  'click .remove_cve_whitelist_single': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const template = Template.instance();
      const current = this;
      const cveKey = current.vuln.name;
      // const versionName = current.version && current.version[0];
      const componentKey = template.data.componentKey;
      const module = template.data.module;
      const arr = module.cveConfig && module.cveConfig.whitelist || [];
      const originalData = _.clone(arr);
      const filteredArr = _.reject(arr, function (e) {
        return e.key === componentKey && e.cveKey === cveKey;
      });
      if (arr.length !== filteredArr.length) {
        Meteor.callAsync('updateCollection', 'Modules', module._id, CVE_WHITELIST, filteredArr, true, originalData
          , function () {
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
            Notify.success(SUCESSFULLY_UPDATED);
          });
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
  }
});

function getConfidence(list, name) {
  const cveDetails = list.find(function (vuln){
    return vuln.vuln && (vuln.vuln.name === name)
  })
  return getConfidenceDetails(cveDetails)
}

function getConfidenceDetails(vuln) {
  const confidenceOrMeta = vuln.confidence ? {
    bump_hints: vuln.bump_hints,
    confidence: vuln.confidence,
    vendor: vuln.vendor,
    product: vuln.product
  } : VULN_META;
  return vuln.ecs ? vuln.ecs : confidenceOrMeta
}
