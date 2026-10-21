import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {ReactiveVar} from 'meteor/reactive-var'
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import License from '/imports/lib/component/License';

Template.moduleTree.onRendered(function () {
  const template = Template.instance();
  const templateData = template.data;
  let components = templateData && templateData.collection;
  if(components && components.length){
    template.treeList.set(false);
    template.treeListError.set(false);
    Meteor.callAsync(
      'getLastModuleScan',
      Router.current().params.moduleId,
      Router.current().params.query.analysis
    ).then(function(data) {
      if(!data){
        template.treeListError.set({error:'No scan found for this tree'})
      }else{
        let jsonData = [];
        traverse(data.dependencies, jsonData, components, null, data);
        template.treeList.set(jsonData);
      }
    });
  }
});
Template.moduleTree.onCreated(function () {
  this.treeList = new ReactiveVar(false);
  this.treeListError = new ReactiveVar(false);
});

Template.moduleTree.helpers({
  treeList: function () {
    const template = Template.instance();
    return template.treeList.get();
  },
  treeListError: function () {
    const template = Template.instance();
    return template.treeListError.get();
  },
  hasResult: function () {
    const template = Template.instance();
    return template.treeListError.get() || template.treeList.get();
  },
  moduleListFilterOptions: function () {
    return {
      layoutDependency:true,
      treeView:true
    };
  }
});

 
function traverse(obj, parent, components, index, scan) {
  if (Array.isArray(obj)){
    _.each(obj, function (val) {
      traverse(val, parent, components, index, scan);
    });
  }else if (obj){
    let matchedComponent = _.find(components, function (Component) {
      return Component.getKey() === obj.key
    });
    const status = matchedComponent && matchedComponent.status;
    let element = {
      component: matchedComponent,
      name:obj.name,
      key:obj.key,
      version:obj.versions && obj.versions[0],
      children: [],
      status
    };
    const moduleId = Router.current().params.moduleId;
    const moduleDoc = moduleId && Modules.findOne(moduleId);
    const linkedReleases = moduleDoc && moduleDoc.linkedReleases;
    if(linkedReleases && linkedReleases.length){
      const matched = linkedReleases.find((item)=>{
        return item.key === element.key
      })
      element.hasLinks = matched ? matched : false
    }
    const linkedModules = moduleDoc && moduleDoc.linkedModules;
    if(linkedModules && linkedModules.length){
      const matchedModule = linkedModules.find((item)=>{
        return item.key === element.key
      })
      element.hasModuleLink = matchedModule ? matchedModule : false
    }
    _.each(obj.dependencies, function (val, index) {
      traverse(val, element, components, index, scan);
    });
    if (parent && parent.children){
      parent.children.push(element);
    }else if(Array.isArray(parent)){
      parent.push(element);
    }
  }
}

function isLicenseSelected(module, component, version, path, selectedLicense) {
  return module && module.isLicenseSelected &&
    module.isLicenseSelected(component, version, path, selectedLicense);
}

Template.moduleTreeNode.events({

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
  }
});

Template.moduleTreeNode.helpers({
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
      let versionLicenses = version.getLicenses(component.getDeclaredLicenses());
      if(versionLicenses && versionLicenses.length > 1){
        selectedLicense = _.find(versionLicenses,function (license) {
          return license && isLicenseSelected(module, component.getKey(), null, null, license.getKey())
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
        licenses.push(selectedLicense.getKey());
      }
    });
    licenses = licenses.filter(n => n);
    if(licenses.length === 0){
      licenses.push('License not detected')
    }
    return '('+_.unique(licenses).join(', ')+')'
  },
  getCurrentSPDXisMulty: function () {
    let module = Template.parentData(3);
    if(!module || (module && !module.moduleIdentifier)){
      module = Modules.findOne({_id: Router.current().params.moduleId});
    }
    const component = this;
    let versions = this.getVersions();
    let selectedLicense = false;
    let multyLicense = false;
    _.forEach(versions,function (version) {
      let lakeLicenses = version.getLicenses(version.component.getDeclaredLicenses());
      let pathLicenses = [];
      version.data().paths.forEach(path => {
        pathLicenses.push(path.licenses);
      })
      pathLicenses = _.unique(_.compact(_.flatten(pathLicenses)),item=>item.key)
      let versionLicenses = pathLicenses ? pathLicenses.map(license => {
        let oneLicense = lakeLicenses.find(lic => (lic.getKey() === license.key || lic.getName() === license.name));
        if(oneLicense){
          if(oneLicense.getName() && !license.name){
            license.name = oneLicense.getName()
          }
          if(oneLicense.getUrl() && !license.url){
            license.url = oneLicense.getUrl()
          }
        }
        if(!license.name){
          license.name = license.key
        }
        return new License(license, version)
      }) : []
      if(versionLicenses && versionLicenses.length > 1){
        selectedLicense = _.find(versionLicenses,function (license) {
          return license && isLicenseSelected(module, component.getKey(), null, null, license.getKey())
        });
        if(!selectedLicense){
          multyLicense = true;
        }
      }
    });
    return multyLicense
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
  getMultyStatus: function () {
    if(this.status === 'violations'){
      return 'violations'
    }else{
      return 'warnings'
    }
  },
  getHasLinks: function () {
    let dependency = Template.parentData(1);
    return dependency.hasLinks
  },
  getLinksTitle: function () {
    let dependency = Template.parentData(1);
    let linkData = dependency.hasLinks && dependency.hasLinks.approve;
    let version = linkData.version ? `(${linkData.version}) ` : null;
    return `${linkData.name} ${version ? version : ''}contact person ${linkData.closedByName}`
  },
  getHasModuleLink: function () {
    let dependency = Template.parentData(1);
    return dependency.hasModuleLink;
  },
  getModuleLinkTitle: function () {
    let dependency = Template.parentData(1);
    let linkData = dependency.hasModuleLink && dependency.hasModuleLink.module;
    if (linkData) {
      let version = linkData.version ? ' (v' + linkData.version + ')' : '';
      return 'Linked to module: ' + linkData.name + version;
    }
    return 'Linked to module';
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
  }
});
