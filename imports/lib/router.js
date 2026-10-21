 
/* global document:false, setTimeout:false */

import {Meteor} from 'meteor/meteor';
import {Router, Iron} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import {Roles} from 'meteor/alanning:roles';
import {rolesReady} from '/imports/lib/roles-ready';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Companies from '/imports/lib/collections/companies';
import Components from '/imports/lib/collections/components';
import Licenses from '/imports/lib/collections/licenses';
import LogEvents from '/imports/lib/collections/logevents';
import SPDXExports from '/imports/lib/collections/SPDXExports';
import SPDXFiles from '/imports/lib/collections/SPDXFiles';
import Policy from '/imports/lib/collections/policy';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import Messages from '/imports/lib/collections/messages';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import SbomFiles from '/imports/lib/collections/sbomFiles';
import COTSComponents from '/imports/lib/collections/cotsComponents';
import Approves from '/imports/lib/collections/approves';
import LegalSettingsTemplates from '/imports/lib/collections/legalSettingsTemplates';
import ManualVulnerabilities from '/imports/lib/collections/manualVulnerabilities';
import Webhooks from '/imports/lib/collections/webhooks';
import Tags from '/imports/lib/collections/tags';
import Scans from '/imports/lib/collections/scans';
import Trademarks from '/imports/lib/collections/trademarks';
import Updates from '/imports/lib/collections/updates';
import Tests from '/imports/lib/collections/tests';
import CSAF from '/imports/lib/collections/csaf';
import {Config} from '/imports/config';
import {serveStoredFile} from '/imports/lib/files/serveStoredFile';
// Shared (imports/lib), never a client-only module: this file is in the SERVER
// bundle too, and anything under imports/.../client/ is excluded from it.
import LicensesService from '/imports/api/licenses';  
import {idSelector, isWrappedId, unwrapId} from '/imports/lib/mongoId';

// Every route whose :_id addresses a COTS or infrastructure component - both
// collections store Mongo ObjectIds rather than Meteor string ids.
const OBJECT_ID_ID_ROUTES = [
  'cotsComponentDetails',
  'infrastructureComponentDetails',
  'cotsManagementComponentsEdit',
  'cotsManagementComponentsLogs',
  'infrastructureManagementComponentsEdit',
  'infrastructureManagementComponentsLogs'
];

const UNASSIGNED = 'Unassigned Modules'
const VL = 'Vulnerability lake'
const COMPONENT_DETAILS = 'Component details'

// Verify Iron and Iron.Router are available from galvanized-iron-router:
if (typeof Iron === 'undefined' || !Iron) {
  console.log('Problem detected missing Iron:Router object "Iron"');
} else if (!Iron.Router) {
  console.log('Problem detected missing Iron:Router object "Iron.Router"');
}

// FIX: galvanized-iron-router bug - MiddlewareStack.dispatch normalizes the URL
// (stripping query string), then handler.params(normalizedUrl) returns query:{}.
// Object.assign(context.params, params) then overwrites the correct query with {}.
// Fix: after setParams stores correct query/hash, protect them from being
// overwritten with empty values by Object.assign in the middleware dispatch.
if (Meteor.isClient && Iron && Iron.RouteController) {
  const _origSetParams = Iron.RouteController.prototype.setParams;
  Iron.RouteController.prototype.setParams = function (value, options) {
    const result = _origSetParams.call(this, value, options);
    // Protect query from being wiped by Object.assign in MiddlewareStack.dispatch
    if (this.params && this.params.query && Object.keys(this.params.query).length > 0) {
      const correctQuery = this.params.query;
      Object.defineProperty(this.params, 'query', {
        get: function () { return correctQuery; },
        set: function (v) {
          // Allow overwrite only if new value has content (real query change)
          if (v && typeof v === 'object' && Object.keys(v).length > 0) {
            Object.defineProperty(this, 'query', {
              value: v, writable: true, configurable: true, enumerable: true
            });
          }
          // Silently ignore empty {} overwrites from MiddlewareStack bug
        },
        configurable: true,
        enumerable: true
      });
    }
    return result;
  };
}

// Force main region template re-render when URL query params change on
// the same route. Many pages read query params in onRendered which only
// fires once. Only triggers when staying on the SAME route (query param
// change) - on route changes, Iron Router swaps templates naturally.
if (Meteor.isClient) {
  let _prevUrl = null;
  let _prevRouteName = null;
  let _rerunGeneration = 0;
  Router.onRerun(function () {
    const curUrl = this.url;
    const curRouteName = this.route && this.route.getName();
    // Only force re-render when the route stays the same but URL changed
    // (i.e. query param change). On route changes, don't interfere -
    // clearing the template mid-transition causes "Must be attached" errors.
    if (_prevUrl && _prevUrl !== curUrl
        && _prevRouteName && _prevRouteName === curRouteName
        && Router._layout) {
      const mainRegion = Router._layout._regions && Router._layout._regions.main;
      if (mainRegion) {
        const tmpl = mainRegion.template();
        if (tmpl) {
          const gen = ++_rerunGeneration;
          mainRegion.template(null);
          Tracker.afterFlush(function () {
            if (gen !== _rerunGeneration) return;
            mainRegion.template(tmpl);
          });
        }
      }
    }
    _prevUrl = curUrl;
    _prevRouteName = curRouteName;
    this.next();
  });
}

Router.configure({
  // disabled because the default layoutTemplate is always rendered, even
  // if a specific route defines its own template. (->light flickering)
  // layoutTemplate: 'layout',
  loadingTemplate: 'routeLoading',
  notFoundTemplate: 'notFound'
  // Global subscriptions moved to persistent startup/client/index.js
  // to prevent grey screen on route changes (async publications in Meteor 3
  // cause waitOn handles to briefly report not-ready when re-created)
});

// Routes reachable without a companyId (auth flow + landing). New routes
// added to this list when they need to render before the company exists.
const AUTH_ROUTES = new Set([
  'home', 'landing', 'login', 'register', 'signup',
  'verifyEmail', 'resetPassword'
]);

// Meteor 3 fix: Iron Router's loading hook blocks rendering until all
// waitOn subscriptions report ready(). With Meteor 3's async publications,
// subscription handles may never signal ready during client-side navigation,
// causing a permanent grey screen.
//
// Fix: keep the loading hook (it acts as a safe buffer during route
// transitions, preventing Blaze template swap conflicts), but add two
// escape hatches:
//   1) On computation re-runs, always proceed (data is in Minimongo).
//   2) On first run, if not ready after a short timeout, force a
//      re-computation so the re-run escape hatch triggers.
if (Meteor.isClient) {
  Iron.Router.hooks.loading = function () {
    // Gate: a logged-in user with no companyId yet (server is still running
    // createNewCompany) sees the "Setting up your workspace" screen instead
    // of an empty app shell. Re-runs reactively when profile.companyId is set.
    if (Meteor.userId()) {
      const user = Meteor.user();
      const routeName = this.route && this.route.getName();
      if (user && (!user.profile || !user.profile.companyId) && !AUTH_ROUTES.has(routeName)) {
        this.layout('blankLayout');
        this.render('creatingWorkspace');
        this.renderRegions();
        return;
      }
    }

    if (this.ready()) {
      this.next();
      return;
    }

    // Re-runs: subscriptions delivered data on the first run, proceed.
    if (this._computation && !this._computation.firstRun) {
      this.next();
      return;
    }

    // First run, not ready - show loading template as a safe buffer,
    // but set a timeout to force-proceed if subscriptions get stuck.
    const controller = this;
    if (!controller._loadingFallbackSet) {
      controller._loadingFallbackSet = true;
      setTimeout(function () {
        controller._loadingFallbackSet = false;
        if (controller._computation && !controller._computation.stopped) {
          controller._computation.invalidate();
        }
      }, 300);
    }

    const template = this.lookupOption('loadingTemplate');
    this.render(template || 'DefaultLoadingTemplate');
    this.renderRegions();
  };
}

// allow request larger than ~100kiB
// we have to 'override' the prototype function (see: https://github.com/iron-meteor/iron-router/blob/devel/lib/router_server.js)
// since IronRouter uses the express.js body parser, this documentation is applicable:
// --> https://github.com/expressjs/body-parser
if (Meteor.isServer) {
  Router.configureBodyParsers = function () {
    Router.onBeforeAction(Iron.Router.bodyParser.json({limit: '5mb'}));
    Router.onBeforeAction(Iron.Router.bodyParser.urlencoded({extended: false}));
  };
}

Router.route('/', {
  name: 'home',
  title: 'Home',
  action: function () {
    if (Session.get('resetPasswordToken')) {   // reset password link from e-mail clicked
      this.layout('blankLayout');
      this.render('resetPassword');
    } else if (Session.get('verifyEmailToken')) {   // verify e-mail link clicked
      this.layout('blankLayout');
      this.render('verifyEmail');
    } else if (Session.get('enrollEmailToken')) {   // enrollment (invitation) link clicked
      this.layout('blankLayout');
      this.render('signup');
    } else {
      this.redirect('/dashboard');
    }
  }
});

Router.route('/landing', {
  name: 'landing',
  where: 'server',

  action: function () {
    let redirectUrl = Config.landingUrl;
    console.log('Sending redirect:', redirectUrl);
    this.response.writeHead(303, {'Location': redirectUrl});
    this.response.end();
  }
});

Router.route('/logout', {
  name: 'logout',

  action: function () {
    Meteor.logout(function () {
      Router.go('home');
    });
  }
});

Router.route('/dashboard', {
  name: 'dashboard',
  layoutTemplate: 'layout',
  title: 'Dashboard',
  data: function () {
    return LogEvents.find({}, {sort: {date: -1}}).fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('activityLogs'),
      Meteor.subscribe('incomingApproves')
    ]
  }
});

Router.route('/login', {
  name: 'login',
  template: 'login',
  layoutTemplate: 'blankLayout',
  title: 'Login'
});

Router.route('/register', {
  name: 'register',
  layoutTemplate: 'blankLayout',
  title: 'Register',
  // Self sign-up is off unless REGISTRATION_ENABLED=true: the server refuses it
  // anyway, so do not offer the form.
  onBeforeAction: function () {
    if (!Config.registrationEnabled) {
      this.redirect('login');
    } else {
      this.next();
    }
  }
});

Router.route('/scans', {
  name: 'scanList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Scans'
});

Router.route('/scans/:_id', {
  name: 'scanDetail',
  layoutTemplate: 'layout',
  parent: 'scanList',
  waitOn: function () {
    return Meteor.subscribe('scanDetail', this.params._id);
  },
  data: function () {
    return Scans.findOne(this.params._id);
  },
  title: function () {
    let data = this.data();
    if (data && !!data.module) {
      return data.module;
    }
    else {
      return 'Scan details';
    }
  }
});

Router.route('/projects', {
  name: 'projectList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Projects'
});

Router.route('/projects/:projectId', {
  name: 'projectModules',
  layoutTemplate: 'layout',
  template: 'moduleList',
  data: function () {
    if (this.params.projectId === Projects.UNASSIGNED) {
      return {name: UNASSIGNED, _id: Projects.UNASSIGNED};
    } else {
      return Projects.findOne(this.params.projectId);
    }
  },
  parent: 'projectList',
  title: function () {
    let data = Projects.findOne(this.params.projectId);
    if (data && !!data.name) {
      return data.name;
    }
    else {
      return UNASSIGNED;
    }
  },
  waitOn: function () {
    return [
      Meteor.subscribe('projectsById', this.params.projectId),
      Meteor.subscribe('projectApprovedVersions', this.params.projectId)
    ]
  }
});

Router.route('/projects/:projectId/settings', {
  name: 'projectSettings',
  layoutTemplate: 'layout',
  waitOn: function () {
    return [
      // Meteor.subscribe('companyAnalysis'),
      Meteor.subscribe('projectsById', this.params.projectId),
      Meteor.subscribe('SPDXFilesImports', this.params.projectId),
      Meteor.subscribe('SPDXImports', this.params.projectId),
      Meteor.subscribe('moduleImports', this.params.projectId),
      Meteor.subscribe('availableLegalSettingsTemplates', 'project'),
      Meteor.subscribe('requirementsHistory', this.params.projectId),
      Meteor.subscribe('licenses', true),
      Meteor.subscribe('webhooksByProjectId', this.params.projectId),
      Meteor.subscribe('testTools')
    ];
  },
  data: function () {
    LicensesService.init()
    return Projects.findOneMapped(this.params.projectId);
  },
  parent: 'projectModules',
  title: 'Settings'
});

Router.route('/projects/:projectId/approve', {
  name: 'projectApprove',
  layoutTemplate: 'layout',
  waitOn: function () {
    return [
      Meteor.subscribe('modulesByProject', this.params.projectId, true)
    ];
  },
  data: function () {
    if (this.params.projectId === Projects.UNASSIGNED) {
      return {name: UNASSIGNED, _id: Projects.UNASSIGNED};
    } else {
      return Projects.findOne(this.params.projectId);
    }
  },
  parent: 'projectModules',
  title: 'Approve'
});

Router.route('/projects/:projectId/approve/:approveId/finalize', {
  name: 'projectApproveFinalize',
  layoutTemplate: 'layout',
  waitOn: function () {
    return [
      Meteor.subscribe('modulesByProject', this.params.projectId, true),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    if (this.params.projectId === Projects.UNASSIGNED) {
      return {name: UNASSIGNED, _id: Projects.UNASSIGNED};
    } else {
      return Projects.findOne(this.params.projectId);
    }
  },
  parent: 'projectApprove',
  title: 'Finalize'
});

Router.route('/projects/:projectId/modules/:moduleId', {
  name: 'moduleDetail',
  parent: 'projectModules',
  action: function () {
    this.redirect(`/projects/${this.params.projectId}/modules/${this.params.moduleId}/dependencies`);
  },
  title: function () {
    let data = Modules.findOne(this.params.moduleId);
    if (data && !!data.name) {
      return data.name;
    } else {
      return 'Module details';
    }
  },
  waitOn: function () {
    return [
      Meteor.subscribe('moduleAnalysis', this.params.moduleId),
      Meteor.subscribe('moduleById', this.params.moduleId)
    ];
  }
});

Router.route('/projects/:projectId/modules/:moduleId/settings', {
  name: 'moduleSettings',
  layoutTemplate: 'layout',
  waitOn: function () {
    return [
      Meteor.subscribe('moduleAnalysis', this.params.moduleId),
      Meteor.subscribe('SPDXFilesExports', this.params.moduleId),
      Meteor.subscribe('SPDXExports', this.params.moduleId),
      Meteor.subscribe('availableLegalSettingsTemplates', 'module'),
      Meteor.subscribe('requirementsHistory', false, this.params.moduleId),
      Meteor.subscribe('moduleById', this.params.moduleId),
      Meteor.subscribe('modulesByProject', false, true),
      Meteor.subscribe('licenses', true),
      Meteor.subscribe('testTools')
    ];
  },
  data: function () {
    LicensesService.init()
    return Modules.findOne(this.params.moduleId);
  },
  parent: 'moduleDetail',
  title: 'Settings'
});

function getModuleData(route) {
  let analysis = route.params.query.analysis;
  let module = Modules.findOne(route.params.moduleId);
  if(module){
    let filter = {
      companyId: module.companyId,
      moduleId: module._id
    };
    if(analysis){
      filter._id = analysis
    }
    Session.set(module._id)
    let options = {sort: {'date': -1}};
    // ReactiveMethod caches a result per (method, arguments) for the whole life of
    // the computation, and these arguments never changed while the route stayed
    // put. So the analysis fetched on first render was handed back on every rerun
    // and a re-analysis - a versioning/viability settings change, or a new scan -
    // stayed invisible until the page was reloaded.
    //
    // `statistics.analysisId` is the pointer the analyzer maintains - ts-analysis
    // writes it with the statistics blob it belongs to, in every environment (the
    // top-level `analysisId` is only ever written by this repo's own dev-only
    // branch, so keying on that fixed nothing in production). The module document
    // is reactive here, so passing the pointer moves the cache key as soon as a new
    // analysis is written, which is the whole point.
    //
    // Passed as an argument rather than merged into `filter` because the server
    // treats it as a preference: if it resolves to nothing (the analysis was
    // deleted) the newest-by-date lookup still answers, so the page never renders
    // as if the module had never been analysed. An explicit ?analysis= deep link
    // stays a hard selector - falling back off it would show a different document.
    let preferredId = analysis ? null :
      (module.statistics && module.statistics.analysisId) || null;
    let analysisItem = ReactiveMethod.call('findOneModuleAnalysis', filter, options, preferredId);
    if(module.infrastructureComponent && module.infrastructureComponent.key) {
      let infrastructureComponent = ReactiveMethod.call('findInfrastructureComponentByKey', module.infrastructureComponent.key)
      if(infrastructureComponent){
        infrastructureComponent.version = module.infrastructureComponent.version
        module.infrastructureComponent = infrastructureComponent;
      }
    }
    if(module.cotsComponent && module.cotsComponent.key) {
      let cotsComponent = ReactiveMethod.call('findCOTSComponentByKey', module.cotsComponent.key)
      if(cotsComponent){
        cotsComponent.version = module.cotsComponent.version
        module.cotsComponent = cotsComponent;
      }
    }
    if(analysisItem){
      module.analysis = [];
      module.analysis.push(analysisItem);
      Session.set(module._id,analysisItem)
    }
  }
  return module;
}

Router.route('/projects/:projectId/modules/:moduleId/legal', {
  name: 'moduleLicenses',
  layoutTemplate: 'substateLayout',
  data: function () {
    return getModuleData(this)
  },
  waitOn: function () {
    return[
      Meteor.subscribe('moduleById', this.params.moduleId),
      Meteor.subscribe('componentModifications', this.params.moduleId)
    ];
  },
  yieldTemplates: {
    'moduleDetail': {to: 'main'},
    'moduleLicensesChart': {to: 'chart'},
    'moduleLicenses': {to: 'tabs'}
  },
  parent: 'moduleDetail',
  title: 'Legal'
});

Router.route('/projects/:projectId/modules/:moduleId/vulnerability', {
  name: 'moduleVulnerability',
  layoutTemplate: 'substateLayout',
  data: function () {
    return getModuleData(this)
  },
  waitOn: function () {
    return [
      Meteor.subscribe('moduleById', this.params.moduleId),
      Meteor.subscribe('componentModifications', this.params.moduleId)
    ];
  },
  yieldTemplates: {
    'moduleDetail': {to: 'main'},
    'moduleVulnerabilityChart': {to: 'chart'},
    'moduleVulnerability': {to: 'tabs'}
  },
  parent: 'moduleDetail',
  title: 'Vulnerabilities'
});

Router.route('/projects/:projectId/modules/:moduleId/components', {
  name: 'moduleComponents',
  layoutTemplate: 'substateLayout',
  data: function () {
    return getModuleData(this)
  },
  waitOn: function () {
    return [
      Meteor.subscribe('moduleById', this.params.moduleId),
      Meteor.subscribe('componentModifications', this.params.moduleId)
    ];
  },
  yieldTemplates: {
    'moduleDetail': {to: 'main'},
    'moduleComponentsChart': {to: 'chart'},
    'moduleComponents': {to: 'tabs'}
  },
  parent: 'moduleDetail',
  title: 'Components'
});

Router.route('/projects/:projectId/modules/:moduleId/dependencies', {
  name: 'moduleDependencies',
  layoutTemplate: 'substateLayout',
  data: function () {
    return getModuleData(this)
  },
  waitOn: function () {
    return [
      Meteor.subscribe('moduleById', this.params.moduleId),
      Meteor.subscribe('moduleMessages', this.params.projectId, this.params.moduleId),
      Meteor.subscribe('componentModifications', this.params.moduleId),
      Meteor.subscribe('moduleTests', this.params.moduleId),
      Meteor.subscribe('testTools')
    ];
  },
  yieldTemplates: {
    'moduleDetail': {to: 'main'},
    'moduleDependenciesChart': {to: 'chart'},
    'moduleDependencies': {to: 'tabs'}
  },
  parent: 'moduleDetail',
  title: 'Dependencies'
});

Router.route('/projects/:projectId/modules/:moduleId/graphs', {
  name: 'moduleGraphs',
  layoutTemplate: 'substateLayout',
  data: function () {
    return getModuleData(this)
  },
  yieldTemplates: {
    'moduleDetail': {to: 'main'},
    'moduleGraphsChart': {to: 'chart'},
    'moduleGraphs': {to: 'tabs'}
  },
  parent: 'moduleDetail',
  title: 'Graphs',
  waitOn: function () {
    return [
      Meteor.subscribe('moduleById', this.params.moduleId),
      Meteor.subscribe('moduleAnalysis', this.params.moduleId)
    ]
  }
});

Router.route('/projects/:projectId/modules/:moduleId/components/:_id', {
  name: 'moduleComponentDetail',
  template: 'componentDetail',
  layoutTemplate: 'layout',
  notFoundTemplate: 'componentDetailNotFound',
  waitOn: function () {
    return [
      Meteor.subscribe('componentDetail', this.params._id),
      Meteor.subscribe('getInfrastructureComponent', unwrapId(this.params._id))
    ];
  },
  data: function () {
    let component = Components.findOne(this.params._id);
    if(!component){
      component = InfrastructureComponents.findOne(idSelector(this.params._id));
      if(component && component._id){
        component.type = 'InfrastructureComponent'
      }
    }
    if (component && component.versions instanceof Array) {
      component.versions.reverse(); // rearrange: latest version on top
    }
    return component;
  },
  parent: 'moduleComponents',
  title: function () {
    let data = this.data();
    if (data && data.data() && !!data.data().name) {
      return data.data().name;
    } else {
      return 'Details';
    }
  }
});

Router.route('/projects/:projectId/modules/:moduleId/licenses/:key', {
  name: 'moduleLicenseDetail',
  template: 'licenseDetail',
  notFoundTemplate: 'licenseDetailNotFound',
  layoutTemplate: 'layout',
  data: function () {
    return Licenses.findOne({key: this.params.key});
  },
  waitOn: function () {
    return [Meteor.subscribe('licenseDetail', this.params.key)];
  },
  parent: 'moduleLicenses',
  title: function () {
    let data = this.data();
    if (data && !!data.name) {
      return data.name;
    } else {
      return 'Details';
    }
  }
});

Router.route('/projects/:projectId/modules/:moduleId/approve', {
  name: 'moduleApprove',
  layoutTemplate: 'layout',
  waitOn: function () {
    return [
      Meteor.subscribe('moduleById', this.params.moduleId)
    ];
  },
  data: function () {
    return Modules.findOne(this.params.moduleId);
  },
  parent: 'moduleDetail',
  title: 'Approve'
});

Router.route('/projects/:projectId/modules/:moduleId/approve/:approveId/finalize', {
  name: 'moduleApproveFinalize',
  layoutTemplate: 'layout',
  waitOn: function () {
    return [
      Meteor.subscribe('moduleById', this.params.moduleId),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Modules.findOne(this.params.moduleId);
  },
  parent: 'moduleApprove',
  title: 'Finalize'
});

Router.route('/settings', {
  name: 'settings',
  template: 'profile',
  layoutTemplate: 'layout',
  title: 'Settings',
  parent: 'dashboard',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

// Router.route('/profile_lists', {
//     name: 'profileLists',
//     template: 'profileLists',
//     layoutTemplate: 'layout',
//     title: 'Black/White lists',
//     parent: 'settings',
//     data: function () {
//       return Meteor.user();
//     }
// });

Router.route('/settings/company/general', {
  name: 'companyGeneralSettings',
  layoutTemplate: 'layout',
  title: 'General settings',
  parent: 'home',
  waitOn: function () {
    return [
      Meteor.subscribe('company'),
      Meteor.subscribe('companyUsers')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/general/info', {
  name: 'companyGeneralInfo',
  template: 'companyGeneralInfo',
  layoutTemplate: 'layout',
  title: 'General info',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company'),
      Meteor.subscribe('companyUsers')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/general/foss', {
  name: 'companyFossSettings',
  template: 'companyFossSettings',
  layoutTemplate: 'layout',
  title: 'FOSS liaison',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/general/psirt', {
  name: 'companyPsirtSettings',
  template: 'companyPsirtSettings',
  layoutTemplate: 'layout',
  title: 'PSIRT contacts',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/general/written-offer', {
  name: 'companyWrittenOfferSettings',
  template: 'companyWrittenOfferSettings',
  layoutTemplate: 'layout',
  title: 'Written offer',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/general/license-lists', {
  name: 'companyLicenseLists',
  template: 'companyLicenseLists',
  layoutTemplate: 'layout',
  title: 'License allow/deny',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company'),
      Meteor.subscribe('licenses', true)
    ];
  },
  data: function () {
    LicensesService.init();
    return Companies.findOne();
  }
});

Router.route('/settings/company/general/component-lists', {
  name: 'companyComponentLists',
  template: 'companyComponentLists',
  layoutTemplate: 'layout',
  title: 'Component allow/deny',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/general/encryption-lists', {
  name: 'companyEncryptionLists',
  template: 'companyEncryptionLists',
  layoutTemplate: 'layout',
  title: 'Encryption',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/general/quality-lists', {
  name: 'companyQualityLists',
  template: 'companyQualityLists',
  layoutTemplate: 'layout',
  title: 'Quality',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company'),
      Meteor.subscribe('testTools')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/users', {
  name: 'companyUsers',
  layoutTemplate: 'layout',
  title: 'Users',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company'),
      Meteor.subscribe('companyUsers')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/loginsHistory', {
  name: 'loginsHistory',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Logins history'
});

Router.route('/settings/company/loginsHistory/no_logins', {
  name: 'loginsHistoryNoLogins',
  layoutTemplate: 'layout',
  parent: 'loginsHistory',
  title: 'Users with no logins'
});

Router.route('/settings/company/api', {
  name: 'companyApi',
  layoutTemplate: 'layout',
  title: 'Scanners & API',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('companyFull')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/api/keys', {
  name: 'companyApiKeys',
  layoutTemplate: 'layout',
  title: 'API keys',
  parent: 'companyApi',
  waitOn: function () {
    return [
      Meteor.subscribe('companyFull')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/api/releases', {
  name: 'companyApiReleases',
  layoutTemplate: 'layout',
  title: 'Release keys',
  parent: 'companyApi',
  waitOn: function () {
    return [
      Meteor.subscribe('companyFull'),
      Meteor.subscribe('approvedReleases')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/api/csaf', {
  name: 'companyApiCsaf',
  layoutTemplate: 'layout',
  title: 'CSAF feed keys',
  parent: 'companyApi',
  waitOn: function () {
    return [
      Meteor.subscribe('companyFull'),
      Meteor.subscribe('companyCsafKeys')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/integrations', {
  name: 'companyIntegrations',
  layoutTemplate: 'layout',
  title: 'Integrations',
  parent: 'settings',
  waitOn: function () {
    return Meteor.subscribe('company');
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/leanix', {
  name: 'companyIntegrationsLeanix',
  layoutTemplate: 'layout',
  title: 'LeanIX',
  parent: 'companyIntegrations',
  waitOn: function () {
    return Meteor.subscribe('company');
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/github', {
  name: 'companyIntegrationsGithub',
  layoutTemplate: 'layout',
  title: 'GitHub',
  parent: 'companyIntegrations',
  waitOn: function () {
    return Meteor.subscribe('company');
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/scanoss', {
  name: 'companyIntegrationsScanoss',
  layoutTemplate: 'layout',
  title: 'SCANOSS',
  parent: 'companyIntegrations',
  waitOn: function () {
    return Meteor.subscribe('company');
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/tfs', {
  name: 'companyIntegrationsTfs',
  layoutTemplate: 'layout',
  title: 'TFS',
  parent: 'companyIntegrations',
  waitOn: function () {
    return Meteor.subscribe('company');
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/jira', {
  name: 'companyIntegrationsJira',
  layoutTemplate: 'layout',
  title: 'Jira',
  parent: 'companyIntegrations',
  waitOn: function () {
    return Meteor.subscribe('company');
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/logs', {
  name: 'companyLogs',
  layoutTemplate: 'layout',
  title: 'Logs',
  parent: 'companyGeneralSettings',
  data: function () {
    return Session.get('company');
  }
});


Router.route('/settings/company/private_licenses', {
  name: 'companyPrivateLicenses',
  layoutTemplate: 'layout',
  title: 'Private Licenses',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company'),
      Meteor.subscribe('licenses', true)
    ];
  },
  data: function () {
    LicensesService.init()
    return Companies.findOne();
  }
});

Router.route('/settings/company/legal_templates', {
  name: 'companyLegalTemplates',
  layoutTemplate: 'layout',
  title: 'Legal templates',
  parent: 'companyGeneralSettings',
  data: function () {
    return LegalSettingsTemplates.find({companyId: {$exists: true}}).fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('companyLegalSettingsTemplates')
    ]
  }
});

Router.route('/settings/company/legal_templates/:legalSettingsTemplateId', {
  name: 'companyLegalTemplatesDetails',
  layoutTemplate: 'layout',
  parent: 'companyLegalTemplates',
  data: function () {
    return LegalSettingsTemplates.findOne({_id:this.params.legalSettingsTemplateId})
  },
  title: function () {
    let data = this.data();
    if (data && !!data.name) {
      return data.name;
    } else {
      return 'Template details';
    }
  },
  waitOn: function () {
    return [
      Meteor.subscribe('companyLegalSettingsTemplates'),
      Meteor.subscribe('legalSettingsTemplateDetail',this.params.legalSettingsTemplateId)
    ]
  }
});

Router.route('/settings/company/vulnerabilities', {
  name: 'companyManualVulnerabilities',
  layoutTemplate: 'layout',
  title: 'Manual vulnerabilities',
  parent: 'companyGeneralSettings',
  data: function () {
    return ManualVulnerabilities.find({}, {sort: {created: -1}}).fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('manualVulnerabilities')
    ];
  }
});

Router.route('/settings/company/tags', {
  name: 'companyTags',
  layoutTemplate: 'layout',
  title: 'Company tags',
  parent: 'companyGeneralSettings',
  data: function () {
    return Tags.find({deleted: {$exists: false}}, {sort: {created: -1}}).fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('tags')
    ];
  }
});

Router.route('/settings/company/tags/removed', {
  name: 'companyTagsDeleted',
  template: 'companyTags',
  layoutTemplate: 'layout',
  title: 'Removed',
  parent: 'companyTags',
  data: function () {
    return Tags.find({deleted: {$exists: true}}, {sort: {deleted: -1}}).fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('tags')
    ];
  }
});

Router.route('/settings/company/private_algorithms', {
  name: 'companyPrivateAlgorithms',
  layoutTemplate: 'layout',
  title: 'Private Algorithms',
  parent: 'companyGeneralSettings',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/webhooks', {
  name: 'companyWebhooks',
  layoutTemplate: 'layout',
  title: 'Webhooks',
  parent: 'companyIntegrations',
  data: function () {
    return Webhooks.find({}, {sort: {created: -1}}).fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('webhooks')
    ];
  }
});

// /components opens the lake itself. Reading it needs no role - the catalog is
// shared, and every editing control on the page is gated on company_component_manager
// individually (create, critical components, and the Edit button on a component).
Router.route('/components', {
  name: 'componentList',
  layoutTemplate: 'layout',
  template: 'componentLakeManager',
  parent: 'dashboard',
  title: 'Components'
});

// Kept so links and bookmarks to the old two-step path still land on the lake.
Router.route('/components/search/manager', {
  name: 'componentLakeManager',
  layoutTemplate: 'layout',
  parent: 'componentList',
  title: 'Component manager search',
  onBeforeAction: function () {
    this.redirect('componentList');
  }
});

Router.route('/components/:_id', {
  name: 'componentDetail',
  layoutTemplate: 'layout',
  notFoundTemplate: 'componentDetailNotFound',
  waitOn: function () {
    return Meteor.subscribe('componentDetail', this.params._id);
  },
  data: function () {
    let component = Components.findOne(this.params._id);
    if (component && component.versions instanceof Array) {
      component.versions.reverse(); // rearrange: latest version on top
    }
    return component;
  },
  parent: 'componentList',
  title: function () {
    let data = this.data();
    if (data && data.data() && !!data.data().name) {
      return data.data().name;
    } else {
      return COMPONENT_DETAILS;
    }
  }
});

Router.route('/critical_components/:_id/edit', {
  name: 'criticalComponentsComponentDetailsEdit',
  template: 'componentDetailsEdit',
  layoutTemplate: 'layout',
  notFoundTemplate: 'componentDetailNotFound',
  waitOn: function () {
    return [
      Meteor.subscribe('componentDetail', this.params._id),
      Meteor.subscribe('licenses', true)
    ];
  },
  data: function () {
    LicensesService.init()
    let component = Components.findOne(this.params._id);
    if (component && component.versions instanceof Array) {
      component.versions.reverse(); // rearrange: latest version on top
    }
    return component;
  },
  parent: 'componentDetail',
  // The parent crumb already carries the component name; this one names the page,
  // matching the 'Info' tab that is active on it and the sibling CPE/Crawlers/Logs
  // routes, which title themselves after their own tab.
  title: function () {
    return 'Info';
  }
});

Router.route('/critical_components/:_id/logs', {
  name: 'criticalComponentsComponentDetailsLogs',
  template: 'componentDetailsLogs',
  layoutTemplate: 'layout',
  notFoundTemplate: 'componentDetailNotFound',
  waitOn: function () {
    return [
      Meteor.subscribe('componentDetail', this.params._id),
      Meteor.subscribe('componentLogs', this.params._id)
    ];
  },
  data: function () {
    return Components.findOne(this.params._id);
  },
  parent: 'criticalComponentsComponentDetailsEdit',
  title: function () {
    return 'Logs';
  }
});

Router.route('/component-search/:key', {
  name: 'componentSearch',
  layoutTemplate: 'layout',
  notFoundTemplate: 'componentDetailNotFound',
  onBeforeAction: function () {
    let comp = Components.findOne({$or:[{key: decodeURIComponent(this.params.key)}, {oldKey: decodeURIComponent(this.params.key)}]});
    if (comp) {
      // this.redirect("/components/" + comp._id);
      Router.go('/components/' + comp._id, {}, {replaceState: true});
    } else {
      this.render('componentDetailNotFound');
    }
  },
  waitOn: function () {
    return Meteor.subscribe('componentDetail', null,
      {$or:[{key: decodeURIComponent(this.params.key)}, {oldKey: decodeURIComponent(this.params.key)}]});
  },
  parent: 'componentList',
  title: 'Component search'
});

Router.route('/apidoc-latest', {
  name: 'apiDocLatest',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'API documentation'
});

Router.route('/licenses', {
  name: 'licenseList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Licenses'
});

Router.route('/licenses/:key', {
  name: 'licenseDetail',
  notFoundTemplate: 'licenseDetailNotFound',
  layoutTemplate: 'layout',
  data: function () {
    LicensesService.init()
    return Licenses.findOne({key: this.params.key});
  },
  waitOn: function () {
    return [
      Meteor.subscribe('licenseDetail', this.params.key),
      Meteor.subscribe('licenses', true)    // keep subscription to list, to prevent reloads if user goes back to list view
    ];
  },
  parent: 'licenseList',
  title: function () {
    let data = this.data();
    if (data && !!data.name) {
      return data.name;
    } else {
      return 'Details';
    }
  }
});

Router.route('/licenses/:key/edit', {
  name: 'licenseEdit',
  notFoundTemplate: 'licenseEditNotFound',
  layoutTemplate: 'layout',
  data: function () {
    return Licenses.findOne({key: this.params.key});
  },
  waitOn: function () {
    return [
      Meteor.subscribe('licenseDetail', this.params.key)
    ];
  },
  parent: 'licenseDetail',
  title: 'Edit license'
});

Router.route('/cots_components', {
  name: 'cotsComponentsList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'COTS components'
});

Router.route('/cots_components/:_id', {
  name: 'cotsComponentDetails',
  layoutTemplate: 'layout',
  notFoundTemplate: 'cotsComponentDetailsNotFound',
  waitOn: function () {
    return Meteor.subscribe('getCOTSComponent', unwrapId(this.params._id));
  },
  data: function () {
    let component = COTSComponents.findOne(idSelector(this.params._id));
    if (component && component.versions instanceof Array) {
      component.versions.reverse();
    }
    return component;
  },
  parent: 'cotsComponentsList',
  title: function () {
    let name = this && this.data() && this.data().getName();
    if (name) {
      return name;
    } else {
      return 'COTS component details';
    }
  }
});

Router.route('/infrastructure_components', {
  name: 'infrastructureComponentsList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Infrastructure components'
});

Router.route('/infrastructure_components/:_id', {
  name: 'infrastructureComponentDetails',
  layoutTemplate: 'layout',
  notFoundTemplate: 'infrastructureComponentDetailsNotFound',
  waitOn: function () {
    return Meteor.subscribe('getInfrastructureComponent', unwrapId(this.params._id));
  },
  data: function () {
    let component = InfrastructureComponents.findOne(idSelector(this.params._id));
    if (component && component.versions instanceof Array) {
      component.versions.reverse();
    }
    return component;
  },
  parent: 'infrastructureComponentsList',
  title: function () {
    let name = this && this.data() && this.data().getName();
    if (name) {
      return name;
    } else {
      return 'Infrastructure component details';
    }
  }
});

Router.route('/management/cots_components/:_id/edit', {
  name: 'cotsManagementComponentsEdit',
  layoutTemplate: 'layout',
  parent: 'cotsComponentDetails',
  data: function () {
    LicensesService.init()
    return COTSComponents.findOne(idSelector(this.params._id));
  },
  waitOn: function () {
    return [
      Meteor.subscribe('getCOTSComponent', unwrapId(this.params._id)),
      Meteor.subscribe('licenses', true)
    ];
  },
  title: function () {
    return 'Edit';
  }
});

Router.route('/management/cots_components/:_id/logs', {
  name: 'cotsManagementComponentsLogs',
  layoutTemplate: 'layout',
  notFoundTemplate: 'componentDetailNotFound',
  parent: 'cotsComponentDetails',
  data: function () {
    return COTSComponents.findOne(idSelector(this.params._id));
  },
  waitOn: function () {
    return [
      Meteor.subscribe('getCOTSComponent', unwrapId(this.params._id)),
      Meteor.subscribe('componentLogs', this.params._id)
    ];
  },
  title: function () {
    return 'Logs';
  }
});

Router.route('/management/infrastructure_components/:_id/edit', {
  name: 'infrastructureManagementComponentsEdit',
  layoutTemplate: 'layout',
  parent: 'infrastructureComponentDetails',
  data: function () {
    LicensesService.init()
    return InfrastructureComponents.findOne(idSelector(this.params._id));
  },
  waitOn: function () {
    return [
      Meteor.subscribe('getInfrastructureComponent', unwrapId(this.params._id)),
      Meteor.subscribe('licenses', true)
    ];
  },
  title: function () {
    return 'Edit';
  }
});

Router.route('/management/infrastructure_components/:_id/logs', {
  name: 'infrastructureManagementComponentsLogs',
  layoutTemplate: 'layout',
  notFoundTemplate: 'componentDetailNotFound',
  waitOn: function () {
    return [
      Meteor.subscribe('getInfrastructureComponent', unwrapId(this.params._id)),
      Meteor.subscribe('componentLogs', this.params._id)
    ];
  },
  data: function () {
    return InfrastructureComponents.findOne(idSelector(this.params._id));
  },
  parent: 'infrastructureComponentDetails',
  title: function () {
    return 'Logs';
  }
});

Router.route('/management/cots_modules', {
  name: 'cotsManagementModules',
  template: 'cotsManagement',
  layoutTemplate: 'layout',
  parent: 'cotsComponentsList',
  title: 'used as Modules',
  waitOn: function () {
    return [
      Meteor.subscribe('cotsModules')
    ];
  },
  data: function () {
    return Modules.find({
      $or: [
        {'properties.architecture': 'cotsModule'}
      ]
    }, {sort: {name: 1}}).fetch();
  }
});

Router.route('/management/infrastructure_modules/', {
  name: 'infrastructureManagementModules',
  template: 'infrastructureManagement',
  layoutTemplate: 'layout',
  parent: 'infrastructureComponentsList',
  title: 'used as Modules',
  waitOn: function () {
    return [
      Meteor.subscribe('infrastructureModules')
    ];
  },
  data: function () {
    return Modules.find({
      $or: [
        {'properties.architecture': 'infrastructureModule'}
      ]
    }, {sort: {name: 1}}).fetch();
  }
});

Router.route('/risks', {
  name: 'risks',
  template: 'risks',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Risk management'
});


Router.route('/risks/tasks', {
  name: 'risksTasks',
  layoutTemplate: 'layout',
  parent: 'risks',
  title: 'Tasks'
});

Router.route('/risks/overview', {
  name: 'risksOverview',
  layoutTemplate: 'layout',
  parent: 'risks',
  title: 'Overview'
});

Router.route('/reports', {
  name: 'reportsList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Company reports'
});

Router.route('/reports/obligations', {
  name: 'reportObligations',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Obligations',
  data: function () {
    let project = Projects.findOne(this.params.query.projectId);
    const moduleId = this.params.query.moduleId;
    let modules = Session.get('modulesByProject');
    let module = modules && modules.find((module)=>{
      return module._id === moduleId
    });
    return (module)?module:project;
  }
});

Router.route('/reports/issue', {
  name: 'reportIssue',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Issues'
});

Router.route('/reports/versioning', {
  name: 'reportVersioning',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Versioning'
});

Router.route('/reports/endoflife', {
  name: 'reportEndoflife',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'End-of-life'
});

Router.route('/reports/algorithms', {
  name: 'reportAlgorithms',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Algorithms'
});

Router.route('/reports/bad-algorithms', {
  name: 'reportBadAlgorithms',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'All bad crypto'
});

Router.route('/reports/vulnerability', {
  name: 'reportVulnerability',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Vulnerabilities'
});

Router.route('/reports/licenses', {
  name: 'reportLicenses',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Licenses'
});

Router.route('/reports/impact/cve', {
  name: 'reportImpactCve',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'CVE impact'
});

Router.route('/reports/impact/component', {
  name: 'reportImpactComponent',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Component impact'
});

Router.route('/reports/impact/algorithm', {
  name: 'reportImpactAlgorithm',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Algorithm impact'
});

Router.route('/reports/bom', {
  name: 'reportBOM',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Software bill of materials'
});

Router.route('/reports/sbom', {
  name: 'reportSbomFiles',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Software bill of materials',
  waitOn: function () {
    return Meteor.subscribe('SbomFiles');
  }
});

Router.route('/reports/sbom/:sbomId/details', {
  name: 'sbomFileDetails',
  layoutTemplate: 'layout',
  parent: 'reportSbomFiles',
  waitOn: function () {
    return [
      Meteor.subscribe('SbomFiles'),
      Meteor.subscribe('sbomFileDetail',this.params.sbomId)
    ];
  },
  data: function () {
    return SbomFiles.findOne({_id:this.params.sbomId})
  },
  title: function () {
    return 'Details';
  }
});

Router.route('/reports/critical_components', {
  name: 'reportCriticalComponents',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Company critical components'
});

Router.route('/reports/critical_components/:_id/edit', {
  name: 'reportCriticalComponentsDetailsEdit',
  template: 'companyComponentManagerDetailsEdit',
  layoutTemplate: 'layout',
  notFoundTemplate: 'componentDetailNotFound',
  waitOn: function () {
    return [
      Meteor.subscribe('componentDetail', this.params._id),
      Meteor.subscribe('licenses', true)
    ];
  },
  data: function () {
    LicensesService.init()
    let component = Components.findOne(this.params._id);
    if (component && component.versions instanceof Array) {
      component.versions.reverse(); // rearrange: latest version on top
    }
    return component;
  },
  parent: 'reportCriticalComponents',
  title: function () {
    let data = this.data();
    if (data && data.data() && !!data.data().name) {
      return data.data().name;
    } else {
      return COMPONENT_DETAILS;
    }
  }
});

Router.route('/reports/credits', {
  name: 'reportCredits',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Credits'
});

Router.route('/reports/notice', {
  name: 'reportNoticeFiles',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Notice files',
  waitOn: function () {
    return Meteor.subscribe('NoticeFiles');
  }
});

Router.route('/reports/notice/:noticeId/details', {
  name: 'noticeFileDetails',
  layoutTemplate: 'layout',
  parent: 'reportNoticeFiles',
  waitOn: function () {
    return [
      Meteor.subscribe('NoticeFiles'),
      Meteor.subscribe('noticeFileDetail',this.params.noticeId)
    ];
  },
  data: function () {
    return NoticeFiles.findOne({_id:this.params.noticeId})
  },
  title: function () {
    return 'Details';
  }
});

Router.route('/reports/cots', {
  name: 'reportCots',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'COTS'
});

Router.route('/reports/dependent', {
  name: 'reportDependent',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Dependent'
});

Router.route('/reports/modification', {
  name: 'reportModification',
  layoutTemplate: 'layout',
  parent: 'reportsList',
  title: 'Modification state'
});

Router.route('/spdx/:documentName-:uuid([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', {
  name: 'SPDXExport',
  where: 'server',

  action: async function () {
    const fs = require('fs');
    const {pipeline} = require('stream');
    const exportDoc = await SPDXExports.findOneAsync({uuid: this.params.uuid});
    if (!exportDoc || !exportDoc.rdfFileId) {
      this.response.writeHead(404);
      this.response.end('SPDX export not found');
      return;
    }
    const fileDoc = await SPDXFiles.collection.findOneAsync(exportDoc.rdfFileId);
    const versionPath = fileDoc && fileDoc.versions && fileDoc.versions.original && fileDoc.versions.original.path;
    if (!versionPath) {
      this.response.writeHead(404);
      this.response.end('SPDX file not found');
      return;
    }
    await serveStoredFile({
      fs,
      pipeline,
      response: this.response,
      filePath: versionPath,
      headers: {
        'Content-Type': fileDoc.type || 'application/rdf+xml',
        'Content-Disposition': `attachment; filename="${fileDoc.name}"`
      },
      notFoundMessage: 'SPDX file not found'
    });
  }
});

Router.route('/policy', {
  name: 'policyList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Company policy',
  waitOn: function () {
    return [
      Meteor.subscribe('policyList')
    ];
  },
  data: function () {
    return Policy.find();
  }
});

Router.route('/policy/:policyId', {
  name: 'policyDetails',
  layoutTemplate: 'layout',
  parent: 'policyList',
  title: function () {
    let data = Policy.findOne(this.params.policyId);
    if (data && !!data.name) {
      return data.name;
    } else {
      return this.params.policyId;
    }
  },
  waitOn: function () {
    return [
      Meteor.subscribe('policyDetail', this.params.policyId),
      Meteor.subscribe('policyList')
    ];
  },
  data: function () {
    return Policy.findOne(this.params.policyId);
  }
});

Router.route('/open_source_policy', {
  name: 'openSourcePolicy',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Open source policy',
  waitOn: function () {
    return [
      Meteor.subscribe('policyForCompany')
    ];
  },
  data: function () {
    return Policy.findOne();
  }
});

Router.route('/copyright_trademarks', {
  name: 'copyrightTrademarks',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Copyright & Trademarks',
  waitOn: function () {
    return [
      Meteor.subscribe('trademarks')
    ];
  },
  data: function () {
    return Trademarks.find();
  }
});

Router.route('/updates', {
  name: 'updates',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Updates',
  waitOn: function () {
    return [
      Meteor.subscribe('updates')
    ];
  },
  data: function () {
    return Updates.find({}, {sort: {published: -1}}).fetch();
  }
});

Router.route('/messages', {
  name: 'messages',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Messages',
  data: function () {
    return Messages.find({},{ sort: { created: -1 } }).fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('messagesByUser')
    ]
  },
  action: function () {
    this.redirect('/messages/inbox');
  }
});

Router.route('/messages/:folder', {
  name: 'messagesFolder',
  layoutTemplate: 'layout',
  template: 'messages',
  parent: 'messages',
  title: 'Inbox',
  waitOn: function () {
    return [
      Meteor.subscribe('messagesByUser')
    ]
  },
  data: function () {
    let filter;
    let type = this.params.query && this.params.query.type;
    if(this.params.folder === 'inbox'){
      filter = {$or:[ {folder:'marked'},{folder:''},{folder:'inbox'},{folder:{$exists: false}} ]};
    }else{
      filter = {folder:this.params.folder}
    }
    if(type){
      filter.type = type
    }
    return Messages.find(filter,{ sort: { created: -1 } }).fetch()
  }
});

Router.route('/check/license', {
  name: 'checkLicense',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Check license',
  waitOn: function () {
    return [
      Meteor.subscribe('modulesByProject', false, true),
      Meteor.subscribe('licenses', true)
    ];
  },
  data: function () {
    LicensesService.init()
  }
});

Router.route('/check/component', {
  name: 'checkComponent',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Check component',
  waitOn: function () {
    return [
      Meteor.subscribe('modulesByProject', false, true)
    ];
  }
});

Router.route('/scan-import', {
  name: 'scanImport',
  layoutTemplate: 'layout',
  parent: 'scanList',
  title: 'Import Scans'
});

Router.route('/vulnerability_lake', {
  name: 'vulnerabilityLakeFind',
  layoutTemplate: 'layout',
  action: function () {
    this.redirect('/vulnerability_lake/simple');
  },
  parent: 'dashboard',
  title: VL
});

Router.route('/vulnerability_lake/simple', {
  name: 'vlSimple',
  template: 'vulnerabilityLakeSearchVulns',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: VL
});

Router.route('/vulnerability_lake/cve_by_name', {
  name: 'vlCveByName',
  template: 'vulnerabilityLakeCve',
  layoutTemplate: 'layout',
  parent: 'vlSimple',
  title: function () {
    let query = this.params && this.params.query
    let parts = query && query.filter && JSON.parse(query.filter)
    if (parts && parts.cve) {
      return parts.cve;
    } else {
      return 'Find vuln';
    }
  }
});

Router.route('/vulnerability_lake/cwe_by_name', {
  name: 'vlCweByName',
  template: 'vulnerabilityLakeCwe',
  layoutTemplate: 'layout',
  parent: 'vlSimple',
  title: function () {
    let query = this.params && this.params.query
    let parts = query && query.filter && JSON.parse(query.filter)
    if (parts && parts.cwe) {
      return parts.cwe;
    } else {
      return 'Find CWE';
    }
  }
});

Router.route('/tests', {
  name: 'testsList',
  template: 'testsList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Tests',
  data: function () {
    return Tests.find().fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('tests'),
      Meteor.subscribe('testTools')
    ];
  }
});

Router.route('/tests/:testId', {
  name: 'testsDetails',
  layoutTemplate: 'layout',
  parent: 'testsList',
  data: function () {
    return Tests.findOne({_id:this.params.testId})
  },
  title: function () {
    let data = this.data();
    if (data && !!data.tool) {
      return data.tool;
    } else {
      return 'Test details';
    }
  },
  waitOn: function () {
    return [
      Meteor.subscribe('testsDetail',this.params.testId),
      Meteor.subscribe('testTools')
    ];
  }
});

Router.route('/csaf', {
  name: 'csafList',
  template: 'csafList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'CSAF',
  data: function () {
    return CSAF.find().fetch();
  },
  waitOn: function () {
    return [
      Meteor.subscribe('csaf')
    ];
  }
});

Router.route('/csaf-create', {
  name: 'csafCreate',
  template: 'csafCreate',
  layoutTemplate: 'layout',
  parent: 'csafList',
  title: 'Create CSAF',
  waitOn: function () {
    if(this.params.query && this.params.query.csafId){
      return [
        Meteor.subscribe('csaf'),
        Meteor.subscribe('csafDetail',this.params.query.csafId),
        Meteor.subscribe('products')
      ];
    }else{
      return [
        Meteor.subscribe('csaf'),
        Meteor.subscribe('products')
      ];
    }
  },
  data: function () {
    return this.params.query && this.params.query.csafId ? CSAF.findOne({_id: this.params.query.csafId}) : {}
  }
});

Router.route('/csaf/:csafId', {
  name: 'csafDetails',
  layoutTemplate: 'substateLayout',
  yieldTemplates: {
    'csafDetails': {to: 'main'}
  },
  parent: 'csafList',
  action: function () {
    this.redirect(`/csaf/${this.params.csafId}/meta`);
  },
  title: function () {
    let data = this.data();
    if (data && (!!data.name || !!data.publishedFileName)) {
      return data.publishedFileName || data.name;
    } else {
      return 'CSAF details';
    }
  },
  waitOn: function () {
    return Meteor.subscribe('csafDetail',this.params.csafId)
  },
  data: function () {
    return CSAF.findOne({_id:this.params.csafId})
  }
});

Router.route('/csaf/:csafId/meta', {
  name: 'csafDetailsMeta',
  layoutTemplate: 'substateLayout',
  parent: 'csafDetails',
  yieldTemplates: {
    'csafDetails': {to: 'main'},
    'csafDetailsMeta': {to: 'tabs'}
  },
  title: 'Meta information',
  waitOn: function () {
    return Meteor.subscribe('csafDetail',this.params.csafId)
  },
  data: function () {
    return CSAF.findOne({_id:this.params.csafId})
  }
});

Router.route('/csaf/:csafId/affected', {
  name: 'csafDetailsAffected',
  layoutTemplate: 'substateLayout',
  parent: 'csafDetails',
  yieldTemplates: {
    'csafDetails': {to: 'main'},
    'csafDetailsAffected': {to: 'tabs'}
  },
  title: 'Affected',
  waitOn: function () {
    return Meteor.subscribe('csafDetail',this.params.csafId)
  },
  data: function () {
    return CSAF.findOne({_id:this.params.csafId})
  }
});

Router.route('/csaf/:csafId/remediation', {
  name: 'csafDetailsRemediations',
  layoutTemplate: 'substateLayout',
  parent: 'csafDetails',
  yieldTemplates: {
    'csafDetails': {to: 'main'},
    'csafDetailsRemediations': {to: 'tabs'}
  },
  title: 'Remediation',
  waitOn: function () {
    return Meteor.subscribe('csafDetail',this.params.csafId)
  },
  data: function () {
    return CSAF.findOne({_id:this.params.csafId})
  }
});

Router.route('/csaf/:csafId/history', {
  name: 'csafDetailsHistory',
  layoutTemplate: 'substateLayout',
  parent: 'csafDetails',
  yieldTemplates: {
    'csafDetails': {to: 'main'},
    'csafDetailsHistory': {to: 'tabs'}
  },
  title: 'History',
  waitOn: function () {
    return Meteor.subscribe('csafDetail',this.params.csafId)
  },
  data: function () {
    return CSAF.findOne({_id:this.params.csafId})
  }
});

Router.route('/csaf/:csafId/json', {
  name: 'csafDetailsJson',
  layoutTemplate: 'substateLayout',
  parent: 'csafDetails',
  yieldTemplates: {
    'csafDetails': {to: 'main'},
    'csafDetailsJson': {to: 'tabs'}
  },
  title: 'JSON',
  waitOn: function () {
    return Meteor.subscribe('csafDetail',this.params.csafId)
  },
  data: function () {
    return CSAF.findOne({_id:this.params.csafId})
  }
});

Router.route('/approves', {
  name: 'approvesList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Company approvals',
  waitOn: function () {
    return [
      Meteor.subscribe('Approves')
    ];
  },
  data: function () {
    return Approves.find();
  }
});

Router.route('/approves/:approveId', {
  name: 'approvesDetails',
  layoutTemplate: 'substateLayout',
  yieldTemplates: {
    'approvesDetails': {to: 'main'}
  },
  parent: 'approvesList',
  action: function () {
    this.redirect(`/approves/${this.params.approveId}/overview`);
  },
  title: function () {
    let data = Approves.findOne(this.params.approveId);
    if (data && !!data.name) {
      return data.name;
    } else {
      return this.params.approveId;
    }
  },
  waitOn: function () {
    return [
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/overview', {
  name: 'approvesDetailsOverview',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsOverview': {to: 'tabs'}
  },
  title: 'Overview',
  waitOn: function () {
    return Meteor.subscribe('approveDetail', this.params.approveId)
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/vulnerabilities', {
  name: 'approvesDetailsVulnerabilities',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsVulnerabilities': {to: 'tabs'}
  },
  title: 'Vulnerabilities',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'vulnerability'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/licenses', {
  name: 'approvesDetailsLicenses',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsLicenses': {to: 'tabs'}
  },
  title: 'Licenses',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'licenses'),
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'legal'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/versioning', {
  name: 'approvesDetailsVersioning',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsVersioning': {to: 'tabs'}
  },
  title: 'Versioning',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'versioning'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/viability', {
  name: 'approvesDetailsViability',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsViability': {to: 'tabs'}
  },
  title: 'Viability',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'viability'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/changes', {
  name: 'approvesDetailsChanges',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsChanges': {to: 'tabs'}
  },
  title: 'Status changes',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'changes'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/export_control', {
  name: 'approvesDetailsExportControl',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsExportControl': {to: 'tabs'}
  },
  title: 'Export control',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'export_control'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/tests', {
  name: 'approvesDetailsTests',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsTests': {to: 'tabs'}
  },
  title: 'Quality',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'tests'),
      Meteor.subscribe('approveDetail', this.params.approveId),
      Meteor.subscribe('testTools')
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/approves/:approveId/capabilities', {
  name: 'approvesDetailsCapabilities',
  layoutTemplate: 'substateLayout',
  parent: 'approvesDetails',
  yieldTemplates: {
    'approvesDetails': {to: 'main'},
    'approvesDetailsCapabilities': {to: 'tabs'}
  },
  title: 'Capabilities',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'capabilities'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/scanners', {
  name: 'scannersList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'CI/CD Integrations'
});

Router.route('/releases', {
  name: 'releasesList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Releases',
  data: function () {
    let user = Meteor.user();
    let params = {};
    let query = this.params.query
    if(query.projectId){
      params.projectId = query.projectId
    }
    if(query.moduleId){
      params['modules._id'] = {$in:[query.moduleId]}
    }
    return user ? ReactiveMethod.call('getApprovedReleases', params) : [];
  }
});

Router.route('/releases/:approveId', {
  name: 'releasesApprove',
  layoutTemplate: 'substateLayout',
  yieldTemplates: {
    'releasesDetails': {to: 'main'}
  },
  parent: 'releasesList',
  action: function () {
    this.redirect(`/releases/${this.params.approveId}/overview`);
  },
  title: function () {
    let data = Approves.findOne(this.params.approveId);
    if (data && !!data.name) {
      return data.name;
    } else if (data && !!data.version) {
      return data.version;
    } else {
      return this.params.approveId;
    }
  },
  waitOn: function () {
    return [
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/releases/:approveId/overview', {
  name: 'releasesDetailsOverview',
  layoutTemplate: 'substateLayout',
  parent: 'releasesApprove',
  yieldTemplates: {
    'releasesDetails': {to: 'main'},
    'releasesDetailsOverview': {to: 'tabs'}
  },
  title: 'Overview',
  waitOn: function () {
    return Meteor.subscribe('approveDetail', this.params.approveId)
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/releases/:approveId/vulnerabilities', {
  name: 'releasesDetailsVulnerabilities',
  layoutTemplate: 'substateLayout',
  parent: 'releasesApprove',
  yieldTemplates: {
    'releasesDetails': {to: 'main'},
    'releasesDetailsVulnerabilities': {to: 'tabs'}
  },
  title: 'Vulnerabilities',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'vulnerability'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/releases/:approveId/new_vulnerabilities', {
  name: 'releasesDetailsNewVulnerabilities',
  layoutTemplate: 'substateLayout',
  parent: 'releasesApprove',
  yieldTemplates: {
    'releasesDetails': {to: 'main'},
    'releasesDetailsNewVulnerabilities': {to: 'tabs'}
  },
  title: 'New vulnerabilities',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'vulnerability'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/releases/:approveId/export_control', {
  name: 'releasesDetailsExportControl',
  layoutTemplate: 'substateLayout',
  parent: 'releasesApprove',
  yieldTemplates: {
    'releasesDetails': {to: 'main'},
    'releasesDetailsExportControl': {to: 'tabs'}
  },
  title: 'Export control',
  waitOn: function () {
    return [
      Meteor.subscribe('approvalReportDetail', this.params.approveId, 'export_control'),
      Meteor.subscribe('approveDetail', this.params.approveId)
    ];
  },
  data: function () {
    return Approves.findOne(this.params.approveId);
  }
});

Router.route('/verify/json', {
  name: 'verifyJson',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Verify JSON'
});

Router.route('/products', {
  name: 'productList',
  layoutTemplate: 'layout',
  parent: 'dashboard',
  title: 'Products',
  waitOn: function () {
    return [
      Meteor.subscribe('products')
    ];
  }
});

Router.route('/settings/company/policies', {
  name: 'companyPoliciesList',
  layoutTemplate: 'layout',
  title: 'Policies',
  parent: 'companyGeneralSettings',
  data: function () {
    return Session.get('company');
  }
});

Router.route('/settings/company/crypto_algorithms', {
  name: 'companyCryptoAlgorithms',
  layoutTemplate: 'layout',
  title: 'Crypto Algorithms',
  parent: 'companyPoliciesList',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

Router.route('/settings/company/endoflife', {
  name: 'companyEndoflife',
  layoutTemplate: 'layout',
  title: 'Component end-of-life',
  parent: 'companyPoliciesList',
  waitOn: function () {
    return [
      Meteor.subscribe('company')
    ];
  },
  data: function () {
    return Companies.findOne();
  }
});

function requireLogin() {
  if (!Meteor.userId()) {
    // Meteor.userId() is reactive and briefly returns null during route
    // transitions even when the user is logged in. Check the stored login
    // token (non-reactive) to avoid flashing blankLayout on every navigation.
    const hasToken = typeof localStorage !== 'undefined' &&
      localStorage.getItem('Meteor.loginToken');
    if (Meteor.loggingIn() || hasToken) {
      this.render(this.loadingTemplate);
    } else {
      this.layout('blankLayout');
      this.render('login');
    }
  } else {
    this.next();
  }
}

function requireRole(role) {
  let user = Meteor.user();
  if (!user || !user.profile || !Roles.userIsInRole(user, role, user.profile.companyId)) {
    // On a fresh page load (new tab / refresh / direct URL) login can complete
    // before the role-assignment subscription arrives. During that window
    // userIsInRole returns false even for authorised users - so only show
    // accessDenied once roles have actually loaded. Until then render the
    // loadingTemplate, which (unlike accessDenied) recovers reactively when the
    // data lands and the guard re-runs.
    if (Meteor.loggingIn() || !rolesReady()) {
      this.render(this.loadingTemplate);
    } else {
      this.render('accessDenied');
    }
  } else {
    this.next();
  }
}

// Router.onBeforeAction('dataNotFound', {only: 'postPage'});
// Router.onBeforeAction(requireLogin, {only: 'scanList'});

if (Meteor.isClient) {
  Router.onBeforeAction(requireLogin, {
    except: [
      'home',
      'login',
      'landing',
      'register'
    ]
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['developer', 'manager','compliance_manager','account_admin']);
  }, {
    only: ['moduleDependencies', 'moduleGraphs', 'moduleVulnerability',
      'moduleLicenses']
  });

  // COTS and infrastructure components are stored with Mongo ObjectIds, whose
  // toString() is 'ObjectID("<hex>")'. Any link built before that was handled
  // carries the stringified form in its path. Rewrite the address bar to the
  // clean id and re-dispatch, so an old bookmark repairs itself instead of
  // resolving to nothing and hanging on the loading spinner.
  Router.onBeforeAction(function () {
    const raw = this.params && this.params._id;
    if (isWrappedId(raw)) {
      Router.go(this.route.getName(), {_id: unwrapId(raw)}, {
        replaceState: true,
        query: this.params.query
      });
      return;
    }
    this.next();
  }, {only: OBJECT_ID_ID_ROUTES});

  Router.onBeforeAction(function () {
    requireRole.call(this, ['company_component_manager']);
  }, {
    only: ['infrastructureManagementModules', 'infrastructureManagementComponentsEdit',
      'cotsManagementModules', 'cotsManagementComponentsEdit', 'criticalComponentsComponentDetailsEdit'
    ]
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['manager','compliance_manager','account_admin']);
  }, {
    only: ['companyApi', 'loginsHistoryNoLogins', 'loginsHistory']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, [
      'account_admin', 'compliance_manager', 'company_security_manager',
      'company_component_manager', 'portfolio_manager', 'manager'
    ]);
  }, {
    only: ['companyGeneralSettings']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin']);
  }, {
    only: ['companyGeneralInfo']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin','compliance_manager']);
  }, {
    only: ['companyFossSettings', 'companyWrittenOfferSettings', 'companyLicenseLists',
      'companyPrivateLicenses']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin','compliance_manager']);
  }, {
    only: ['companyLegalTemplates']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin','company_security_manager']);
  }, {
    only: ['companyPsirtSettings', 'companyPrivateAlgorithms']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin','compliance_manager','company_security_manager']);
  }, {
    only: ['companyEncryptionLists', 'companyQualityLists']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin','compliance_manager','company_security_manager','company_component_manager']);
  }, {
    only: ['companyComponentLists']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin','company_security_manager','company_component_manager']);
  }, {
    only: ['companyManualVulnerabilities']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin','portfolio_manager','manager','company_security_manager','compliance_manager']);
  }, {
    only: ['companyTags']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin','company_security_manager','compliance_manager']);
  }, {
    only: ['companyPoliciesList', 'companyCryptoAlgorithms', 'companyEndoflife']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['compliance_manager']);
  }, {
    only: ['policyList', 'policyDetails']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['company_component_manager']);
  }, {
    only: ['reportCriticalComponents', 'reportCriticalComponentsDetailsEdit', 'licenseEdit']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin']);
  }, {
    only: ['companyLogs', 'companyUsers']
  });

  Router.onBeforeAction(function () {
    requireRole.call(this, ['account_admin']);
  }, {
    only: ['companyIntegrations', 'companyIntegrationsLeanix', 'companyIntegrationsTfs', 'companyIntegrationsJira',
      'companyIntegrationsGithub', 'companyIntegrationsScanoss']
  });

  Router.onAfterAction(function () {
    let pageTitle = this.route.getName();
    try {
      const title = this.route && this.route.options && this.route.options.title;
      // `.call(this)`: every dynamic title reads `this.params`, so calling the function
      // bare threw into the catch below and the tab fell back to the raw route name on
      // 16 routes. The breadcrumb builder (common/route-helpers.js) binds it the same way.
      const routeTitle = typeof title === 'function' ? title.call(this) : title;
      if(routeTitle){
        pageTitle = routeTitle
      }
      // A title may legitimately run before its data has arrived; keep the route name
      // rather than breaking navigation. Nothing else may depend on this catch.
      // eslint-disable-next-line no-empty, sonarjs/no-ignored-exceptions
    }catch (e) {}
    document.title = Config.name + ' - ' + pageTitle;
    // Global - Remove splash screen after rendered layout
    setTimeout(function () {
      $('#splash').css('display', 'none');
      document.body.classList.add('app-loaded');
    });
  });
}

Router.plugin('dataNotFound', {
  notFoundTemplate: 'NotFound',
  only: ['signup', 'componentDetail', 'licenseDetail', 'licenseEdit']
});
