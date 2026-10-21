import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Roles} from 'meteor/alanning:roles';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Spacebars} from 'meteor/spacebars';
import {formatPath} from '/imports/client/ui/helpers/template-helpers';
import {pathLocation, pathLicenses} from '/imports/lib/analysis/pathLocation';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import ComponentModifications from '/imports/lib/collections/componentModifications';
import Utils from '/imports/lib/utils';
import Pluralize from 'pluralize';
import Notify from '/imports/api/notify';
import Company from '/imports/lib/company/Company';
import {Config} from '/imports/config';

const IN_PROGRESS = 'action-in-progress';
const ASIDE_CLASS = '.aside-section-content';
const NOT_ALLOWED = 'You are not allowed to change this settings!'

function isUnchanged(module, component, version, path) {
  return module && module.isComponentUnchanged && module.isComponentUnchanged(component.key, version, pathLocation(path));
}

function isLooseCoupled(module, component, version, path) {
  return module && module.isComponentLooseCoupled && module.isComponentLooseCoupled(component.key, version, pathLocation(path));
}

function isLicenseSelected(module, component, version, path, selectedLicense) {
  return module && module.isLicenseSelected &&
    module.isLicenseSelected(component, version, path, selectedLicense);
}

Template.moduleComponent.onRendered(function () {
  $('[data-toggle="tooltip"]').tooltip({
    container: 'body'
  });
});
Template.moduleComponent.events({

  'click .expand-table': function (event) {
    event.preventDefault();
    const panelEl = $(event.target).closest('.panel-body');
    const icon = panelEl.find('.table-header i.ts-panel-toggle');
    const body = panelEl.find('.table-collapse, .description');
    body.slideToggle(300);

    icon.toggleClass('fa-chevron-right').toggleClass('fa-chevron-down');
    panelEl.toggleClass('').toggleClass('collapsed');
  },

  'click .check-unchanged': function (event, instance) {
    event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    $(event.target).parent().addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Modules.findOne({_id: Router.current().params.moduleId});
      const component = instance.data;
      // const path = this.path;
      // const version = this.version;
      const arr = module.getUnchangedComponents();
      const originalData = _.clone(arr);
      const comment = 'added by component checkbox. By ' + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
        + ', ' + now.toLocaleDateString();
      if (event.target.checked && !!isUnchanged(module, component, '*', null) === false) {
        arr.push({key: component.getKey(), comment: comment});
        Meteor.callAsync('updateCollection', 'Modules', module._id, 'componentConfig.unchanged', arr, true, originalData);
      } else {
        const filteredArr = _.reject(arr, function (e) {
          return e.key === component.getKey();
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Modules', module._id, 'componentConfig.unchanged', filteredArr, true, originalData);
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    $(event.target).parent().removeClass(IN_PROGRESS);
  },

  'click .check-loose': function (event, instance) {
    event.preventDefault();
    const user = Meteor.user();
    const now = new Date();
    //console.log("Checkbox clicked: event =", event, ", instance=", instance);
    $(event.target).parent().addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const module = Modules.findOne({_id: Router.current().params.moduleId});
      const component = instance.data;
      // const path = this.path;
      // const version = this.version;
      const arr = module.getLooseCoupledComponents();
      const originalData = _.clone(arr);
      const comment = 'added by component checkbox. By ' + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)) + ', ' + now.toLocaleDateString();
      if (event.target.checked && isLooseCoupled(module, component, null, null) === false) {
        arr.push({key: component.getKey(), comment: comment});
        Meteor.callAsync('updateCollection', 'Modules', module._id, 'componentConfig.looseCoupled', arr, true, originalData);
      } else {
        const filteredArr = _.reject(arr, function (e) {
          return e.key === component.getKey();
        });
        if (arr.length !== filteredArr.length) {
          Meteor.callAsync('updateCollection', 'Modules', module._id, 'componentConfig.looseCoupled', filteredArr, true, originalData);
        }
      }
    }else{
      Notify.danger(NOT_ALLOWED);
    }
    $(event.target).parent().removeClass(IN_PROGRESS);
  },

  'change .change-changes-url': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const val = $(event.target).val();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const params = {
        component:{
          key: this.component.key,
          version: this.version,
          paths: [pathLocation(this.path)],
          changesUrl: this.changesUrl
        },
        updates:{
          changesUrl: val
        },
        moduleId: Router.current().params.moduleId,
        moduleName: Modules.findOne(Router.current().params.moduleId).getName(),
        projectId: Router.current().params.projectId
      }
      this.changesUrl = val
      Meteor.callAsync('ComponentModifications.CreateChangesList', params).then(function() {
        $(event.target).closest(ASIDE_CLASS).removeClass(IN_PROGRESS);
      })
    }else{
      Notify.danger(NOT_ALLOWED);
      $(event.target).closest(ASIDE_CLASS).removeClass(IN_PROGRESS);
    }
  },

  'change .change-modification-notice': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const val = $(event.target).val();
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    if (Roles.userIsInRole(user, 'manager',user.profile.companyId)) {
      const params = {
        component:{
          key: this.component.key,
          version: this.version,
          paths: [pathLocation(this.path)],
          changesText: this.changesText
        },
        updates:{
          changesText: val
        },
        moduleId: Router.current().params.moduleId,
        moduleName: Modules.findOne(Router.current().params.moduleId).getName(),
        projectId: Router.current().params.projectId
      }
      this.changesText = val
      Meteor.callAsync('ComponentModifications.CreateChangesList', params).then(function() {
        $(event.target).closest(ASIDE_CLASS).removeClass(IN_PROGRESS);
      })
    }else{
      Notify.danger(NOT_ALLOWED);
      $(event.target).closest(ASIDE_CLASS).removeClass(IN_PROGRESS);
    }
  },
  'click input[name=components]': function (event) {
    const content = $(event.target).closest('.content');
    let selectedComponents = [];
    content.find('input[name=components]:checked').each(function () {
      selectedComponents.push(this.value);
    });
    Session.set('selectedComponents', selectedComponents);
  }
});

Template.moduleComponent.helpers({

  getModuleComponentOptions: function () {
    let params;
    if (Router.current().params.projectId) {
      params = {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId,
        _id: this.data()._id
      };
    } else {
      params = {
        _id: this.data()._id
      };
    }
    return params;

  },

  unchanged: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    return isUnchanged(module, this.component, this.version, this.path) ? 'checked' : false;
  },

  unchangedInformation: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    return isUnchanged(module, this.component, this.version, this.path)
  },

  looseCoupled: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    return isLooseCoupled(module, this.component, this.version, this.path) ? 'checked' : false;
  },

  looseCoupledInformation: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    return isLooseCoupled(module, this.component, this.version, this.path)
  },

  // The shared helper: one escaping decision, and it accepts both path shapes.
  formatPath: formatPath,

  getVersion: function () {
    return this.getVersion();
  },

  getPath: function () {
    return Template.parentData(0);
  },

  licenseStatus: function () {
    const company = Session.get('company')
    const companyClass = new Company(company);
    const project = Projects.findOne({_id: Router.current().params.projectId});
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const path = Template.parentData(1);
    const version = Template.parentData(0).version.data();
    const license = this.data();
    if (!!license && !!version && !!path && !!path.component) {
      let pathLicense = _.clone(_.find(pathLicenses(path.path), function (licenseItem) {
        return licenseItem.key === license.key || licenseItem.key === license.name
      }));
      if (pathLicense && pathLicense.status) {
        pathLicense.status.computedStatus = Utils.computedLicenseStatusDetails(module, project,
          companyClass, license.key, pathLicense.status);
        return pathLicense.status
      }
    }
  },

  viabilityStatus: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const filter = Router.current().params.query.analysis || null;
    const analysis = module && module.getAnalysis ? module.getAnalysis(null, filter) : false;
    if(analysis && analysis.viabilityConfig && analysis.viabilityConfig.enabled) {
      const component = Template.parentData(1);
      const viability = component.getViability();
      if (!viability || viability.error) {
        // overwrite default label for warnings state with reason label "unknown"
        return new Spacebars.kw({state: 'warnings', label: 'Viability'});
      }
      return component.getViabilityStatus(analysis);
    }else{
      return 'disabled'
    }
  },

  getModuleOptions: function () {
    return {
      moduleId:Router.current().params.moduleId,
      projectId:Router.current().params.projectId
    };
  },

  getProject: function () {
    return Projects.findOne({_id: Router.current().params.projectId})
  },

  getCompany: function () {
    return Session.get('company')
  },

  getModule2: function () {
    let moduleLvl2 = Template.parentData(2)
    let moduleLvl3 = Template.parentData(3)
    let moduleLvl4 = Template.parentData(4)
    const fallback = moduleLvl3.moduleIdentifier ? moduleLvl3 : moduleLvl4;
    return moduleLvl2.moduleIdentifier ? moduleLvl2 : fallback
  },

  isDisabled: function (status) {
    return status === 'disabled'
  },

  notOk: function () {
    return this.status !== 'ok';
  },

  getProblemDescription: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const filter = Router.current().params.query.analysis || null;
    const analysis = module && module.getAnalysis ? module.getAnalysis(null, filter) : false;
    const component = this;
    const item = component.data();
    // Scanned components frequently carry only `key` and no `name`; requiring
    // `item.name` here left description undefined, which emptied the Copy details
    // clipboard text and made Create issue throw before opening its modal.
    const name = component.getName ? component.getName() : (item && (item.name || item.key));
    if (item && name) {
      const status = component.status;
      const reasons = [];
      if (component.getViabilityStatus(analysis) != 'ok'){
        reasons.push('Viability problems')
      }
      let haveVulnerabilities = _.any(component.getVersions(),function (version) {
        return version.getVulnerabilities().length
      });
      if (haveVulnerabilities){
        reasons.push('Vulnerability problems')
      }
      let haveLicenseProblems = _.flatten(_.map(component.getVersions(),function (version) {
        return _.map(version.data().paths,function (path) {
          return _.map(path.licenses,function (license) {
            return license.status.status
          });
        });
      }));
      if (_.any(haveLicenseProblems,function (problem) {
        return problem == 'violations' || problem == 'warnings'})){
        let status = _.any(haveLicenseProblems,function (problem) {
          return problem == 'violations'
        });
        const text = 'License '+ (status ? 'violations' : 'warnings');
        reasons.push(text)
      }
      // One entry per path, not one per version: _.map over the versions returns
      // an array of arrays, and joining that renders the inner arrays with their
      // own commas ("/a/b,/a/c; /d").
      const paths = _.flatten(_.map(item.versions, function (e) {
        return _.map(e.paths, function (i) {
          return i.path
        });
      }));
      // This text is pasted into a Jira/GitHub ticket, so every sentence has to
      // stand on its own: drop the ones whose list came back empty rather than
      // emitting "This is due to ." or "The component is found at: .".
      return {
        text: 'Component "'+ name +'" has status "' + status + '" \n'+
        (reasons.length ? 'This is due to '+ reasons.join('; ') +'. \n' : '') +
        'Please check whether this component is still needed and resolve the reported ' + status + '. \n' +
        (paths.length ? 'The component is found at: '+ paths.join('; ') +'. \n' : '') +
        'Thank you for your support.',
        title: name +' - ' + status + ' (' + Config.name + ' generated task)'
      }
    }
  },

  module: function () {
    return Modules.findOne({_id: Router.current().params.moduleId});
  },

  componentDetails: function () {
    return this.data()
  },

  hasJiraConnection: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const item = this.data();
    if (module && item) {
      return _.find(module.jira, function (elem) {
        return elem.ecs == item.key
      });
    }
  },

  hasTfsConnection: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const item = this.data();
    if (module && item) {
      return _.find(module.tfs, function (elem) {
        return elem.ecs == item.key
      });
    }
  },

  getCountVersions: function () {
    const versions = this.getVersions();
    if (versions) {
      return Pluralize('version', versions.length, true)
    }
  },

  getCountAppearances: function () {
    const versions = this.getVersions();
    const places = _.flatten(_.map(versions, function (item) {
      return item.data().paths
    }));
    if (places) {
      return Pluralize('appearance', places.length, true)
    }
  },

  getCountAppearancesByVersion: function (version) {
    const paths = version && version.paths;
    if (paths) {
      return Pluralize('appearance', paths.length, true)
    }
  },

  getComponentPath: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    const version = this.data();
    const component = this.component.data();
    const changesUrl = ComponentModifications.findOne({
      'component.key': component.key,
      'component.version': version.version,
      'moduleId': Router.current().params.moduleId,
      'companyId': companyId,
      'type': 'changesUrl'
    }, {sort: {created: -1}, limit: 1})
    const changesText = ComponentModifications.findOne({
      'component.key': component.key,
      'component.version': version.version,
      'moduleId': Router.current().params.moduleId,
      'companyId': companyId,
      'type': 'changesText'
    }, {sort: {created: -1}, limit: 1})
    return _.map(version.paths, function (item, index) {
      return {
        path: item,
        component: component,
        version: version.version,
        changesUrl: changesUrl && changesUrl.value,
        changesText: changesText && changesText.value,
        path_index: index
      }
    })
  },

  getVersionLicenses: function () {
    const version = Template.parentData(1);
    return version.getLicenses(version.component.getDeclaredLicenses())
  },

  componentInLicense: function () {
    return Router.current().route.getName() !== 'moduleComponents'
  },

  describeObligations: function (obligations) {
    return _.map(obligations.split('; '),function (obligation) {
      return Utils.translateObligations(obligation)
    })
  },

  describeViolations: function (violations) {
    return _.map(violations.split('; '),function (violation) {
      return Utils.translatePermitions(violation)
    })
  },

  getType: function () {
    let status = this.type;
    return status ? {
      key:status+'s',
      text:status[0].toUpperCase()+status.substr(1,status.length)
    }: null
  },

  notWhitelisted: function () {
    let status = this.requireWhitelist;
    return status !== undefined && status === false
  },

  getLabelForNotWhitelisted: function () {
    return 'Not allowed (but '+this.label+')'
  },

  getSelectedLicense: function (listLicenses) {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    // const path = Template.parentData(0).path;
    // const version = Template.parentData(0).version;
    const component = Template.parentData(0).component;
    let selectedLicense = false;
    if(listLicenses.length > 1){
      listLicenses.forEach(function (license) {
        if(isLicenseSelected(module, component.key, null, null, license.getKey())){
          selectedLicense =  license;
        }
      });
      if(!selectedLicense){
        listLicenses = _.sortBy(listLicenses,'key');
        selectedLicense = listLicenses[0]
      }
    }else{
      listLicenses = _.sortBy(listLicenses,'key');
      selectedLicense = listLicenses[0]
    }
    return selectedLicense
  },

  moreThanOneLicense: function (licenses) {
    return licenses.length >  1
  },

  actionRoute: function () {
    const component = this;
    return {
      route: 'moduleDependencies',
      params: {
        projectId: Router.current().params.projectId || Projects.UNASSIGNED,
        moduleId: Router.current().params.moduleId
      },
      query: {
        filter: component.getKey()
      }
    }
  }
});


