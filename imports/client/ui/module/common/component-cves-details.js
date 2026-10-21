/* global document:false, swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {Roles} from 'meteor/alanning:roles';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Vulnerability from '/imports/lib/component/Vulnerability';
import Utils from '/imports/lib/utils';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import {escapeHtml} from '/imports/lib/html/tableCells';
import {Config} from '/imports/config';

const IN_PROGRESS = 'action-in-progress';
const ASIDE_CLASS = '.aside-section-content';
const NOT_ALLOWED = 'You are not allowed to change this settings!'
const CVE_WHITELIST = 'cveConfig.whitelist'
const VULN_META = {
  url: Config.appUrl + 'vulnerability_lake',
  confidence: 'HIGH',
  type: 'ts-vl'
}

Template.componentCvesDetails.onCreated(function () {
  let mappedVulns = new ReactiveVar();
  let requestInProgress = new ReactiveVar();
  this.mappedVulns = mappedVulns;
  this.requestInProgress = requestInProgress;
  const module = this.data && this.data.module;
  const project = module && module.projectId ? Projects.findOne(module.projectId) : null;
  const currentModule = Session.get('moduleDetailConfidenceMinScore');
  Session.set('confidenceMinScore', currentModule || Utils.resolveConfidenceMinScore(module, project, '3'))
  Session.set('confidenceFiltered', false)
});

Template.componentCvesDetails.helpers({
  getRef: function () {
    const vulnerability = this;
    return Router.url('vlCveByName', null, {query:{filter:  JSON.stringify({cve: vulnerability.getName()})}});
  },
  hasVulns: function () {
    return this.vulns && this.vulns.length
  },
  getVulns: function () {
    const currentData = Template.currentData();
    const minConf = Session.get('confidenceMinScore')
    const vulns = [];
    const countBefore = this.vulns && this.vulns.length
    this.vulns.forEach(function (cveDetails) {
      if(!cveDetails.vuln) {
        cveDetails.vuln = _.clone(cveDetails)
      }
      const params = {filter:  JSON.stringify({cve: cveDetails.vuln.name})}
      if(currentData && currentData.module && currentData.module.environmentalConfig) {
        let {v2vectorString, v3vectorString, v4vectorString} = currentData.module.environmentalConfig
        params.v2_environmental_vector = v2vectorString
        params.v3_environmental_vector = v3vectorString
        params.v4_environmental_vector = v4vectorString
      }
      cveDetails.vuln.link = Router.url('vlCveByName', null, {query: params})
      const vuln = new Vulnerability(getConfidenceDetails(cveDetails), cveDetails.vuln)
      if(minConf && vuln.getConfidenceScore() && vuln.getConfidenceScore() >= +minConf){
        vulns.push(vuln);
      }
    });
    const countAfter = vulns && vulns.length
    Session.set('confidenceFiltered', countBefore !== countAfter)
    return _.sortBy(_.sortBy(vulns, function(vuln){
      return +vuln.getScore()
    }).reverse(), function(vuln){
      return +vuln.getConfidence()
    })
  },
  confidenceMinScore: function () {
    return Session.get('confidenceMinScore')
  },
  mappedVulns: function () {
    const template = Template.instance();
    const componentKey = template.data.version.component.getKey();
    const current = template.mappedVulns.get() || {};
    const list = current[componentKey]
    const minConf = Session.get('confidenceMinScore')
    const countBefore = list && list.length
    const listAfter =  minConf && list ? list.filter((vuln)=>{
      return vuln.getConfidenceScore() >= +minConf
    }): list
    const countAfter = listAfter && listAfter.length
    Session.set('confidenceFiltered', countBefore !== countAfter)
    return listAfter
  },
  requestInProgress: function () {
    const template = Template.instance();
    return template.requestInProgress.get()
  },
  confidenceFiltered: function () {
    return Session.get('confidenceFiltered')
  },
  isCveWhiteListedAnywhere: function () {
    const template = Template.instance();
    const current = Template.currentData();
    if(current.vuln){
      const cveKey = current.vuln.name;
      const version = template.data.version;
      // const versionName = version.getVersion();
      const componentKey = version.component.getKey();
      const company = template.data.company;
      const project = template.data.project;
      const module = template.data.module;
      return (company && typeof company.isCveWhitelisted === 'function' && company.isCveWhitelisted(cveKey, componentKey, null)) ||
        (project && typeof project.isCveWhitelisted === 'function' && project.isCveWhitelisted(cveKey, componentKey, null)) ||
        (module && typeof module.isCveWhitelisted === 'function' && module.isCveWhitelisted(cveKey, componentKey, null))
    }
    return false
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
    return item && item.label
  },
  muteVariants: function () {
    return muteVariants
  }
});

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

Template.componentCvesDetails.events({
  'click .change_confidence': function (event) {
    event.preventDefault();
    const value = $(event.target).attr('data-value');
    Session.set('confidenceMinScore', value)
  },
  'click .add_cve_whitelist': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const template = Template.instance();
      const module = template.data.module;
      const data = this;
      const cve = data.vuln;
      const cveKey = cve.name;
      const componentKey = template.data.version.component.getKey();
      // const versionName = template.data.version.getVersion();
      const arr = module.getWhitelistedCve();
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
        $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
        reason = document.getElementById('confirmationText').value;
        if(reason){
          const comment = (reason?reason:'NO REASON PROVIDED') + ' By ' + Utils.username() + ', ' + now.toLocaleDateString();
          arr.push({key: componentKey, comment: comment, cveKey:cveKey});
          Meteor.callAsync(
            'updateCollection',
            'Modules',
            module._id,
            CVE_WHITELIST,
            arr,
            true,
            originalData
          ).then(function() {
            Meteor.setTimeout(function () {
              $(ASIDE_CLASS).removeClass(IN_PROGRESS);
            },1)
            Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
          });
        }else{
          Notify.warn('You are not allowed to mute vulnerability without reason!');
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
        }
      });
    }else{
      Notify.danger(NOT_ALLOWED);
    }
  },
  'click .add_cve_whitelist_fast': function (event) {
    event.preventDefault();
    const value = $(event.target).attr('data-value');
    const reason = muteVariants.find((variant)=>variant.value === value)
    const user = Meteor.user();
    const now = new Date();
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const template = Template.instance();
      const module = template.data.module;
      const data = this;
      const cve = data.vuln;
      const cveKey = cve.name;
      const componentKey = template.data.version.component.getKey();
      // const versionName = template.data.version.getVersion();
      const arr = module.getWhitelistedCve();
      const originalData = _.clone(arr);
      $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
      const comment = (reason?reason.label:'NO REASON PROVIDED') + ' By ' + Utils.username() + ', ' + now.toLocaleDateString();
      arr.push({key: componentKey, comment: comment, cveKey:cveKey});
      Meteor.callAsync(
        'updateCollection',
        'Modules',
        module._id,
        CVE_WHITELIST,
        arr,
        true,
        originalData
      ).then(function() {
        Meteor.setTimeout(function () {
          $(ASIDE_CLASS).removeClass(IN_PROGRESS);
        },1)
        Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
      });
    }else{
      Notify.danger(NOT_ALLOWED);
    }
  },
  'click .remove_cve_whitelist': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const template = Template.instance();
      const module = template.data.module;
      const data = this;
      const cve = data.vuln;
      const cveKey = cve.name;
      const componentKey = template.data.version.component.getKey();
      // const versionName = template.data.version.getVersion();
      const arr = module.getWhitelistedCve();
      const originalData = _.clone(arr);
      const filteredArr = _.reject(arr, function (e) {
        return e.key === componentKey && e.cveKey === cveKey;
      });
      if (arr.length !== filteredArr.length) {
        Meteor.callAsync(
          'updateCollection',
          'Modules',
          module._id,
          CVE_WHITELIST,
          filteredArr,
          true,
          originalData
        ).then(function() {
          Meteor.setTimeout(function () {
            $(ASIDE_CLASS).removeClass(IN_PROGRESS);
          },1)
          Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
        });
      }
    }else{
      Notify.danger(NOT_ALLOWED);
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    }
  },
  'click .less_details': function (event) {
    event.preventDefault();
    const template = Template.instance();
    const componentKey = template.data.version.component.getKey();
    const current = template.mappedVulns.get() || {};
    current[componentKey] = null;
    template.mappedVulns.set(current)
  },
  'click .get_details': function (event) {
    event.preventDefault();
    const self = this;
    const template = Template.instance();
    template.requestInProgress.set(true)
    const cveIds = self.vulns.map(function (vuln){
      return vuln.vuln && vuln.vuln.name
    })
    const currentData = Template.currentData();
    const analisedVulns = self.vulns
    Meteor.callAsync('tsVulnerabilityCveDetails', {cves: cveIds}).then(function(data) {
      if(data && data.data && data.data.cves){
        let vulns = [];
        data.data.cves.forEach(function (cveDetails) {
          const impact = Utils.groupedImpactVersions(cveDetails.impact)
          let v2 = impact && impact.cvss2 && impact.cvss2.baseScore
          let v3 = impact && impact.cvss3 && impact.cvss3.baseScore
          let v4 = impact && impact.cvss4 && impact.cvss4.baseScore
          let vector2 = impact && impact.cvss2 && impact.cvss2.vectorString
          let vector3 = impact && impact.cvss3 && impact.cvss3.vectorString
          let vector4 = impact && impact.cvss4 && impact.cvss4.vectorString
          let cvssVersions = Object.keys(impact)
          let analisedVulnExtra;
          if(analisedVulns && analisedVulns.length){
            const analisedVuln = analisedVulns.find((item)=>{
              return item.vuln.name === cveDetails.cve_id
            })
            analisedVulnExtra = analisedVuln && analisedVuln.vuln
          }
          const params = {filter:  JSON.stringify({cve: cveDetails.cve_id})}
          if(currentData && currentData.module && currentData.module.environmentalConfig) {
            let {v2vectorString, v3vectorString, v4vectorString} = currentData.module.environmentalConfig
            params.v2_environmental_vector = v2vectorString
            params.v3_environmental_vector = v3vectorString
            params.v4_environmental_vector = v4vectorString
            cveDetails.link = Router.url('vlCveByName', null, {query: params})
          }
          vulns.push(new Vulnerability(getConfidence(self.vulns, cveDetails.cve_id), {
            cwe: true,
            name: cveDetails.cve_id,
            cisa: cveDetails.cisa,
            weakness: cveDetails.weakness,
            impact,
            link: cveDetails.link,
            description: cveDetails.description,
            lastmodified: cveDetails.lastmodified,
            references: cveDetails.references,
            environmental: analisedVulnExtra && analisedVulnExtra.environmental,
            cvssScore: analisedVulnExtra ? +analisedVulnExtra.cvssScore : v4 || v3 || v2,
            baseScore: analisedVulnExtra ? +analisedVulnExtra.baseScore : v4 || v3 || v2,
            vectorString: analisedVulnExtra ? analisedVulnExtra.vectorString : vector4 || vector3 || vector2,
            cvssVersion: cvssVersions[cvssVersions.length - 1].substr(-1)
          }));
        });
        if(vulns.length < cveIds.length){
          const updatedCveIds = vulns.map(function (vuln){
            return vuln.vuln && vuln.vuln.name
          })
          self.vulns.forEach(function (vuln){
            if(updatedCveIds.indexOf(vuln.vuln && vuln.vuln.name) === -1){
              vulns.push(new Vulnerability(getConfidenceDetails(vuln), vuln.vuln));
            }
          })
        }
        const componentKey = template.data.version.component.getKey();
        const current = template.mappedVulns.get() || {};
        current[componentKey] = _.sortBy(_.sortBy(vulns, function(vuln){
          return +vuln.getScore()
        }).reverse(), function(vuln){
          return +vuln.getConfidence()
        });
        template.mappedVulns.set(current)
      }
      template.requestInProgress.set(false)
    })
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
