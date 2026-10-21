import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Utils from '/imports/lib/utils';
import License from '/imports/lib/component/License';
import Company from '/imports/lib/company/Company';

Template.moduleDependency.onRendered(function () {
  $('[data-toggle="tooltip"]').tooltip({
    container: 'body'
  });
});

Template.moduleDependency.events({

  'click input[name=components]': function (event) {
    const content = $(event.target).closest('.content');
    let selectedComponents = [];
    content.find('input[name=components]:checked').each(function () {
      selectedComponents.push(this.value);
    });
    Session.set('selectedComponents', selectedComponents);
  },
  'click .dependency-select': function (event) {
    event.preventDefault();
    const component = this;
    Session.set('currentComponent', component.getKey());
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const project = module && module.projectId ? Projects.findOne(module.projectId) : null;
    const currentModule = Session.get('moduleDetailConfidenceMinScore');
    Session.set('confidenceMinScore', currentModule || Utils.resolveConfidenceMinScore(module, project, '3'))
  },
  'click .dep-root-set-license': function (event) {
    event.preventDefault();
    event.stopPropagation();
    const componentKey = (this.getKey && this.getKey()) || this.key;
    if (!componentKey) return;
    Session.set('currentComponent', componentKey);
    // Focus the picker in the aside on the next render tick. The class is the
    // shared `licenseCatalogSelect` one: the root picker's own
    // `.root-license-picker-select` went away when the two license selects were
    // merged, and this lookup would silently focus nothing.
    setTimeout(function () {
      const picker = document.querySelector('.ecs-dependencies-aside .license-catalog-select');
      if (picker && typeof picker.focus === 'function') picker.focus();
    }, 50);
  }
});

function isLicenseSelected(module, component, version, path, selectedLicense) {
  return module && module.isLicenseSelected &&
    module.isLicenseSelected(component, version, path, selectedLicense);
}

function isCveWhitelisted(cveKey, componentKey, version, company, project, module) {
  return company.isCveWhitelisted(cveKey, componentKey, version) || (project && typeof project.isCveWhitelisted === 'function' &&
    project.isCveWhitelisted(cveKey, componentKey, version)) || module.isCveWhitelisted(cveKey, componentKey, version)
}

Template.moduleDependency.helpers({

  licenseStatus: function () {
    const analysisInfo = Template.parentData(0);
    if(analysisInfo && analysisInfo.statuses && analysisInfo.statuses.legal){
      return analysisInfo.statuses.legal
    }
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const project = Projects.findOne({_id: Router.current().params.projectId});
    const company = Session.get('company')
    const companyClass = new Company(company);
    const component = this.data();
    let licenses = [];
    let selectedLicense = false;
    let multyLicense = false;
    _.forEach(component.versions,function (version) {
      _.forEach(version.paths,function (path) {
        let pathLicenses = path.licenses;
        if(pathLicenses && pathLicenses.length > 1){
          selectedLicense = _.find(pathLicenses,function (license) {
            return license && isLicenseSelected(module, component.key, null, null, license.key)
          });
          if(!selectedLicense){
            pathLicenses = _.sortBy(pathLicenses,'key');
            selectedLicense = pathLicenses[0];
            multyLicense = true;
          }
        }else{
          selectedLicense = pathLicenses && pathLicenses[0] || null
        }
        licenses.push(Utils.updateLicenseStatus(module, project, companyClass, new License(selectedLicense)))
      });
    });
    let result;
    if(multyLicense){
      result = 'warnings'
    } else if(_.any(licenses,function (license) {
      let status = (!license.status.status)? license.status : license.status.status;
      return status === 'violations'
    })){
      result = 'violations'
    }else if (_.any(licenses,function (license) {
      let status = (!license.status.status)? license.status : license.status.status;
      return status === 'warnings'
    })){
      result = 'warnings'
    } else{
      result = 'ok'
    }
    return result;
  },

  vulnerabilityStatus: function () {
    const analysisInfo = Template.parentData(0);
    if(analysisInfo && analysisInfo.statuses && analysisInfo.statuses.vulnerability){
      return analysisInfo.statuses.vulnerability
    }
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const project = Projects.findOne({_id: Router.current().params.projectId});
    const company = Session.get('company')
    const companyClass = new Company(company);
    const component = Template.parentData(0);
    const minConfidence = Session.get('moduleDetailConfidenceMinScore') || Utils.resolveConfidenceMinScore(module, project, undefined);
    let vulnerabilities = [];
    _.forEach(component.getVersions(),function (version) {
      let list = version.getVulnerabilities();
      list = _.map(_.filter(list, function (vuln) {
        return !isCveWhitelisted(vuln.name, component.getKey(), null, companyClass, project, module) &&
          (!minConfidence || (minConfidence && confidenceMap(+minConfidence) >= vuln.confidence))
      }), function (vuln) {
        return vuln.status
      });
      vulnerabilities.push(list);
    });
    vulnerabilities = _.unique(_.flatten(vulnerabilities));
    let result = 'ok';
    if(vulnerabilities.indexOf('violations') > -1){
      result = 'violations'
    }else if (vulnerabilities.indexOf('warnings') > -1){
      result = 'warnings'
    }
    return result;
  },

  viabilityStatus: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const analysis = Session.get(module._id);
    if(analysis && analysis.viabilityConfig && analysis.viabilityConfig.enabled){
      const component = Template.parentData(0);
      return component.statuses && component.statuses.viability || 'disabled';
    }else{
      return 'disabled'
    }
  },

  versioningMessage: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const analysis = Session.get(module._id);
    if(analysis && analysis.versioningConfig && analysis.versioningConfig.enabled) {
      const component = Template.parentData(0);
      const versioning = component.getVersioning();
      if (versioning) {
        return versioning.message || versioning.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  versioningStatus: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const analysis = Session.get(module._id);
    if(analysis && analysis.versioningConfig && analysis.versioningConfig.enabled) {
      const component = Template.parentData(0);
      const versioning = component.getVersioningStatus();
      return (component.statuses && component.statuses.versioning) || versioning || 'disabled';
    }else{
      return 'disabled'
    }
  },

  versioningIcon: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const analysis = Session.get(module._id);
    if(analysis && analysis.versioningConfig && analysis.versioningConfig.enabled) {
      const component = Template.parentData(0);
      const versioning = component.getVersioning();
      if(versioning){
        if (versioning.status === 'violations') {
          return 'fa-hourglass-end'
        }else if(versioning.status === 'warnings') {
          return 'fa-hourglass-half';
        }else if(versioning.status === 'ok') {
          return 'fa-hourglass-start';
        }
      }else{
        return 'fa-hourglass-o'
      }
    }else{
      return 'fa-hourglass-o'
    }
  },

  encryptionMessage: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const analysis = Session.get(module._id);
    if(analysis && analysis.algorithmsConfig && analysis.algorithmsConfig.length) {
      const component = Template.parentData(0);
      const encryption = component.getEncryption();
      if (encryption) {
        return encryption.message || encryption.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  encryptionStatus: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const analysis = Session.get(module._id);
    if(analysis && analysis.algorithmsConfig && analysis.algorithmsConfig.length) {
      const component = Template.parentData(0);
      const encryption = component.getEncryption();
      if (encryption) {
        return encryption.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  endoflifeMessage: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const analysis = Session.get(module._id);
    if(analysis && analysis.endoflifePolicy && analysis.endoflifePolicy.enabled) {
      const component = Template.parentData(0);
      const info = component.getEndoflife();
      if (info) {
        return info.message || info.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  endoflifeStatus: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const analysis = Session.get(module._id);
    if(analysis && analysis.endoflifePolicy && analysis.endoflifePolicy.enabled) {
      const component = Template.parentData(0);
      const info = component.getEndoflife();
      if (info) {
        return info.status;
      } else {
        return 'disabled'
      }
    }else{
      return 'disabled'
    }
  },

  showEndoflife: function (status) {
    return status !== 'disabled' && status !== 'ok'
  },

  isSelected: function () {
    let current = Session.get('currentComponent');
    return (current === this.getKey()) ? 'dependency-active': ''
  },

  getCurrentVersion: function () {
    let versions = this.getVersions();
    let listVersions = [];
    _.forEach(versions,function (version) {
      listVersions.push(version.getVersion());
    });
    return listVersions.join(', ')
  },

  getCurrentSPDX: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const component = this;
    let versions = this.getVersions();
    let licenses = [];
    let selectedLicense = false;
    _.forEach(versions,function (version) {
      let versionLicenses = _.flatten(version.data().paths.map(item=>item.licenses));
      if(versionLicenses && versionLicenses.length > 1){
        selectedLicense = _.find(versionLicenses,function (license) {
          return license && isLicenseSelected(module, component.getKey(), null, null, license.key)
        });
        if(!selectedLicense){
          let list = _.sortBy(versionLicenses,'key');
          selectedLicense = list[0];
        }
      }else{
        let list = _.sortBy(versionLicenses,'key');
        selectedLicense = list[0]
      }
      if(selectedLicense){
        licenses.push(selectedLicense.key);
      }
    });
    licenses = licenses.filter(n => n);
    if(licenses.length === 0){
      licenses.push('License - n/d')
    }
    return '('+_.unique(licenses).join(', ')+')'
  },
  getLicenseLabels: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const component = this;
    let versions = this.getVersions();
    let licenses = [];
    let selectedLicense = false;
    _.forEach(versions,function (version) {
      let versionLicenses = _.flatten(version.data().paths.map(item=>item.licenses));
      if(versionLicenses && versionLicenses.length > 1){
        selectedLicense = _.find(versionLicenses,function (license) {
          return license && isLicenseSelected(module, component.getKey(), null, null, license.key)
        });
        if(!selectedLicense){
          let list = _.sortBy(versionLicenses,'key');
          selectedLicense = list[0];
        }
      }else{
        let list = _.sortBy(versionLicenses,'key');
        selectedLicense = list[0]
      }
      if(selectedLicense){
        licenses.push(selectedLicense.key);
      }
    });
    licenses = licenses.filter(n => n);
    if(licenses.length === 0){
      licenses.push('n/d');
    }
    return _.unique(licenses);
  },
  getCurrentSPDXisMulty: function () {
    const component = Template.parentData(0);
    return component.statuses && component.statuses['multy-legal'] === 'violations';
  },
  getMultyStatus: function () {
    if(this.status === 'violations'){
      return 'violations'
    }else{
      return 'warnings'
    }
  },
  getRootClass: function () {
    let module = Template.parentData();
    if(!module || (module && !module.moduleIdentifier)){
      module = Template.parentData(4);
    }
    const filter = Router.current().params.query.analysis || null;
    const analysis = module && module.getAnalysis ? module.getAnalysis(null, filter) : false;
    return (analysis && analysis.rootComponentsCount === 1 && this.root) ? 'dependency-root' : ''
  },
  isRoot: function () {
    return this.root
  },
  isSingleRoot: function () {
    let module = Template.parentData();
    if (!module || (module && !module.moduleIdentifier)) {
      module = Template.parentData(4);
    }
    const filter = Router.current().params.query.analysis || null;
    const analysis = module && module.getAnalysis ? module.getAnalysis(null, filter) : false;
    return !!(analysis && analysis.rootComponentsCount === 1 && this.root);
  }
});

function confidenceMap(score) {
  if (score) {
    if (score === 5) {
      return 1
    } else if (score === 4) {
      return 2
    } else if (score === 2) {
      return 4
    } else if (score === 1) {
      return 5
    } else {
      return score
    }
  }
  return 5;
}
