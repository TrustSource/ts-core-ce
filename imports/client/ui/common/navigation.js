
/* global window:false location:false */

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import {Tracker} from 'meteor/tracker';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {Roles} from 'meteor/alanning:roles';
import UserExtUtils from '/imports/lib/userExtUtils';
import {AutoForm} from 'meteor/aldeed:autoform';
import {Config} from '/imports/config';

Template.navigation.events({

  // Collapse menu in mobile mode after click on element
  'click #side-menu a:not([href$="\\#"])': function () {
    if ($(window).width() < 769) {
      $('body').toggleClass('show-sidebar');
    }
  },
  'click .logoutNav': function (event) {
    event.preventDefault();
    Meteor.logout(function () {
      Router.go('home');
    });
  },
  'click .change_company': function (event) {
    const companyId = $(event.target).attr('id');
    if (companyId) {
      Meteor.callAsync('changeCompany', companyId).then(function() {
        location.reload();
      }).catch(function(error) {
        console.log(error);
      });
    }
  }
});

Template.navigation.onCreated(function () {
});

// Module-level variables to persist scroll across re-renders (no reactivity)
let _sideMenuScrollTop = 0;
let _restoringScroll = false;

// Re-open the sections the user had open. Applied to whichever `.sidebar-dropdown`
// elements are passed in, because the menu is rebuilt in two different ways: the whole
// navigation template is re-created when the layout changes, and the {{#each menuItems}}
// block alone is re-rendered whenever the company / account-admin data it reads arrives.
function restoreOpenMenus($dropdowns) {
  const openMenus = Tracker.nonreactive(function () {
    return Session.get('_navOpenMenus');
  }) || [];
  if (!openMenus.length) { return; }
  $dropdowns.each(function () {
    if (!this.id || openMenus.indexOf(this.id) === -1) { return; }
    $(this).addClass('in');
    $('[href="#' + this.id + '"]').removeClass('collapsed').attr('aria-expanded', 'true');
  });
}

// Preserve collapsible menu state across template re-renders
Template.navigation.onRendered(function () {
  restoreOpenMenus(this.$('.sidebar-dropdown'));

  const sideMenu = document.getElementById('side-menu');
  if (sideMenu) {
    // Track scroll position on the actual scroll container (#side-menu, not #menu)
    this._scrollHandler = function () {
      if (!_restoringScroll) {
        _sideMenuScrollTop = sideMenu.scrollTop;
      }
    };
    sideMenu.addEventListener('scroll', this._scrollHandler);

    // Restore after Blaze re-renders (reactive helper changes during same-layout navigation)
    this._observer = new MutationObserver(function () {
      if (_sideMenuScrollTop && sideMenu.scrollTop !== _sideMenuScrollTop) {
        _restoringScroll = true;
        sideMenu.scrollTop = _sideMenuScrollTop;
        _restoringScroll = false;
      }
    });
    this._observer.observe(sideMenu, { childList: true, subtree: true });

    // Restore on initial render (layout change case)
    Meteor.defer(function () {
      if (_sideMenuScrollTop) {
        sideMenu.scrollTop = _sideMenuScrollTop;
      }
    });
  }

  // Track collapse/expand.
  //
  // `show`/`hide`, not `shown`/`hidden`: the latter only fire once the collapse animation
  // has finished, which on a busy page takes over a second. Clicking a menu link inside a
  // section you had just opened therefore navigated before the open state was ever
  // recorded, and the menu came back fully collapsed - the "first click collapses
  // everything, later ones don't" behaviour, since by the second click the animation had
  // long finished and the state was on record.
  //
  // Delegated from #side-menu, which belongs to this template and so survives: bound
  // straight onto the `.sidebar-dropdown` nodes, the handlers would die with any re-render
  // of the menu list, which is rebuilt whenever the company data it reads changes.
  this.$('#side-menu').on('show.bs.collapse', '.sidebar-dropdown', function () {
    const current = Session.get('_navOpenMenus') || [];
    const id = this.id;
    if (id && current.indexOf(id) === -1) {
      Session.set('_navOpenMenus', current.concat(id));
    }
  });
  this.$('#side-menu').on('hide.bs.collapse', '.sidebar-dropdown', function () {
    const current = Session.get('_navOpenMenus') || [];
    const id = this.id;
    Session.set('_navOpenMenus', current.filter(function (m) { return m !== id; }));
  });
});

// A menu item that is re-rendered on its own (the {{#each menuItems}} case) comes back
// closed, so it restores its own state instead of waiting for the whole navigation
// template to be re-created.
Template.navigationSidebarItem.onRendered(function () {
  restoreOpenMenus(this.$('.sidebar-dropdown'));
});

Template.navigation.onDestroyed(function () {
  this.$('#side-menu').off('show.bs.collapse hide.bs.collapse');
  const sideMenu = document.getElementById('side-menu');
  if (sideMenu) {
    _sideMenuScrollTop = sideMenu.scrollTop;
  }
  if (this._scrollHandler && sideMenu) {
    sideMenu.removeEventListener('scroll', this._scrollHandler);
  }
  if (this._observer) {
    this._observer.disconnect();
  }
});

Template.navigation.helpers({
  menuItems: function () {
    const accountAdminEmail = Session.get('companyAccountAdmin');
    return [
      {
        id: 'dashboard',
        name: 'Overview',
        iconClass: 'fa fa-home',
        route: 'dashboard',
        isActiveRouteRegex: '^dashboard'
      },
      {
        id: 'inbound',
        name: 'Inbound (Scans)',
        iconClass: 'fa fa-terminal',
        roles: 'developer,compliance_manager,manager,account_admin',
        route: false,
        subItems: [
          {
            id: 'checkLicense',
            name: 'Check',
            route: 'checkLicense',
            isActiveRouteRegex: '^checkLicense|^checkComponent'
          },
          {
            id: 'scanImport',
            name: 'Import Scans',
            route: 'scanImport',
            isActiveRouteRegex: '^scanImport$'
          },
          {
            id: 'scans',
            name: 'CI/CD Scan',
            route: 'scanList',
            isActiveRouteRegex: '^scanList$|^scanDetail$'
          },
          {
            id: 'testsList',
            name: 'SW Quality Scans',
            route: 'testsList',
            isActiveRouteRegex: '^tests'
          }
        ]
      },
      {
        id: 'processing',
        name: 'Internal',
        iconClass: 'fa fa-list-ul',
        // The group is shown to every role one of its pages is for; each page
        // carries its own roles.
        roles: 'developer,compliance_manager,manager,account_admin,company_security_manager',
        route: false,
        liClass: 'intro-content',
        subItems: [
          {
            id: 'products',
            name: 'Products',
            route: 'productList',
            isActiveRouteRegex: '^product',
            roles: 'developer,compliance_manager,manager,account_admin,company_security_manager'
          },
          {
            id: 'projects',
            name: 'Projects',
            route: 'projectList',
            isActiveRouteRegex: '^project|^module',
            roles: 'developer,compliance_manager,manager,account_admin'
          },
          {
            id: 'risks',
            name: 'Risks',
            route: 'risksOverview',
            isActiveRouteRegex: '^risks',
            roles: 'developer,compliance_manager,manager,account_admin,company_security_manager'
          },
          {
            id: 'approvesList',
            name: 'Approvals',
            route: 'approvesList',
            isActiveRouteRegex: '^approves',
            roles: 'compliance_manager,manager'
          },
          {
            id: 'releases',
            name: 'Releases',
            route: 'releasesList',
            isActiveRouteRegex: '^releases',
            roles: 'developer,compliance_manager,manager'
          },
          {
            id: 'reportsList',
            name: 'Reports',
            route: 'reportsList',
            // Match Analysis sub-routes but exclude Outbound (reportSbomFiles,
            // reportNoticeFiles) and the separate reportCriticalComponents nav entry.
            isActiveRouteRegex: '^report(?!Sbom|Notice|Critical)',
            roles: 'developer,compliance_manager,manager,account_admin'
          }
        ]
      },
      {
        id: 'outbound',
        name: 'Outbound',
        iconClass: 'fa fa-file-text',
        route: false,
        // Company security manager only sees CSAF, which it may publish (CSAF_CREATE_ROLES).
        roles: 'compliance_manager,manager,account_admin,company_security_manager',
        subItems: [
          {
            id: 'reportSbomFiles',
            name: 'SBOM + CBOM',
            route: 'reportSbomFiles',
            isActiveRouteRegex: '^reportSbomFiles',
            roles: 'compliance_manager,manager,account_admin'
          },
          {
            id: 'reportNoticeFiles',
            name: 'Notice Files',
            route: 'reportNoticeFiles',
            isActiveRouteRegex: '^reportNoticeFiles',
            roles: 'compliance_manager,manager,account_admin'
          },
          {
            id: 'csafList',
            name: 'CSAF',
            route: 'csafList',
            isActiveRouteRegex: '^csaf',
            roles: 'compliance_manager,manager,account_admin,company_security_manager'
          },
          {
            id: 'verifyJson',
            name: 'Verify',
            route: 'verifyJson',
            isActiveRouteRegex: '^verifyJson',
            roles: 'compliance_manager,manager,account_admin'
          }
        ]
      },
      {
        id: 'knowledge',
        name: 'Knowledge',
        iconClass: 'fa fa-graduation-cap',
        route: false,
        liClass: 'intro-knowledge',
        subItems: [
          {
            id: 'componentList',
            name: 'Component Lake',
            route: 'componentList',
            isActiveRouteRegex: '^component'
          },
          {
            id: 'infrastructureComponentsList',
            name: 'Infrastructure Elements',
            route: 'infrastructureComponentsList',
            isActiveRouteRegex: '^infrastructureComponentsList'
          },
          {
            id: 'cotsComponentsList',
            name: '3rd party (COTS)',
            route: 'cotsComponentsList',
            isActiveRouteRegex: '^cotsComponentsList'
          },
          {
            id: 'vulnerabilityLake',
            name: 'Vulnerability Lake',
            route: 'vlSimple',
            queryParams: {
              filter: JSON.stringify({
                component: 'lodash'
              })
            },
            isActiveRouteRegex: '^vulnerabilityLake$|^vl'
          },
          {
            id: 'licenseList',
            name: 'Licenses',
            route: 'licenseList',
            isActiveRouteRegex: '^licenseList$|^licenseDetail$|^licenseEdit$'
          },
          {
            id: 'openSourcePolicy',
            name: 'Open source policy',
            route: 'openSourcePolicy',
            isActiveRouteRegex: '^openSourcePolicy'
          }
        ]
      },
      {
        id: 'administration',
        name: 'Administration',
        iconClass: 'fa fa-unlock-alt',
        route: false,
        liClass: 'intro-settings',
        subItems: [
          {
            id: 'companyIntegrations',
            name: 'Integrations',
            route: 'companyIntegrations',
            isActiveRouteRegex: '^companyIntegrations',
            roles: 'account_admin'
          },
          {
            id: 'companyGeneralSettings',
            name: 'Settings',
            route: 'companyGeneralSettings',
            isActiveRouteRegex: '^companyGeneralSettings$',
            roles: 'account_admin,compliance_manager,company_security_manager,company_component_manager,portfolio_manager,manager'
          },
          {
            id: 'companyUsers',
            name: 'User Management',
            route: 'companyUsers',
            isActiveRouteRegex: '^companyUsers$',
            roles: 'account_admin'
          },
          {
            id: 'companyApi',
            name: 'API keys',
            route: 'companyApi',
            isActiveRouteRegex: '^companyApi$',
            roles: 'account_admin'
          },
          {
            id: 'companyPoliciesList',
            name: 'Policies',
            route: 'companyPoliciesList',
            isActiveRouteRegex: '^companyPoliciesList|^companyCryptoAlgorithms',
            roles: 'account_admin,company_security_manager,compliance_manager'
          },
          {
            id: 'companyLogs',
            name: 'Audit logs',
            route: 'companyLogs',
            isActiveRouteRegex: '^companyLogs',
            roles: 'account_admin'
          }
        ]
      },
      {
        id: 'updates',
        name: 'Updates',
        iconClass: 'fa fa-regular fa-bell',
        route: 'updates',
        isActiveRouteRegex: '^updates',
        liClass: 'visible-xs'
      },
      {
        id: 'messages',
        name: 'Inbox',
        iconClass: 'fa fa-regular fa-envelope-open',
        route: 'messagesFolder',
        routeParams: {
          folder: 'inbox'
        },
        isActiveRouteRegex: '^messages',
        liClass: 'visible-xs'
      },
      {
        id: 'settings',
        name: 'Profile',
        iconClass: 'fa fa-regular fa-user',
        route: 'settings',
        isActiveRouteRegex: '^settings',
        liClass: 'visible-xs'
      },
      {
        id: 'accountAdminEmail',
        name: 'Contact Account Admin',
        iconClass: 'fa fa-regular fa-paper-plane',
        link: 'mailto:' + accountAdminEmail,
        liClass: 'visible-xs'
      },
      {
        id: 'support',
        name: 'Support',
        iconClass: 'fa fa-regular fa-circle-question',
        link: Config.helpUrl,
        liClass: 'visible-xs'
      },
      {
        id: 'apiDocLatest',
        name: 'API Documentation',
        iconClass: 'fa fa-regular fa-file-lines',
        route: 'apiDocLatest',
        isActiveRouteRegex: 'apiDocLatest',
        liClass: 'visible-xs'
      },
      {
        id: 'logout',
        name: 'Logout',
        iconClass: 'fa fa-solid fa-arrow-right-from-bracket',
        liClass: 'logoutNav visible-xs'
      }
    ]
  },
  company: function () {
    return Session.get('company');
  },

  userCompanies: function () {
    return ReactiveMethod.call('getUserCompanies');
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  userDisplayName: function () {
    return UserExtUtils.username()
  },

  isCurrentCompany: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId === this._id;
  },

  hasMoreThanOneCompany: function () {
    const user = Meteor.user();
    if (!user || !user.profile) return false;
    const scopes = Roles.getScopesForUser(user);
    return scopes.length > 1;
  }
});

Template.navigationSidebarItem.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

AutoForm.addInputType('switch', {
  template: 'afSwitch',
  valueOut: function () {
    return !!this.is(':checked');
  },
  valueConverters: {
    'string': function (val) { return val ? 'true' : 'false'; },
    'stringArray': function (val) { return val ? ['true'] : ['false']; },
    'number': function (val) { return val ? 1 : 0; },
    'numberArray': function (val) { return val ? [1] : [0]; }
  },
  contextAdjust: function (context) {
    if (context.value === true) {
      context.atts.checked = '';
    }
    delete context.atts.required;
    return context;
  }
});
Template.afSwitch.helpers({
  isEditable: function () {
    return this.atts.disabled === '' ?'disabled':'';
  }
});

AutoForm.addInputType('enumSwitch', {
  template: 'afEnumSwitch',
  valueIn: function (val, atts) {
    return val === atts.trueValue;
  },
  valueOut: function () {
    return this.is(':checked') ? this.attr( 'truevalue' ) : this.attr( 'falsevalue' );
  }
});
Template.afEnumSwitch.helpers({
  isEditable: function () {
    return this.atts.disabled === '' ?'disabled':'';
  },
  atts: function selectedAttsAdjust() {
    let atts = _.clone(this.atts);
    if (this.value === true) {
      atts.checked = 'checked';
    }
    return atts;
  }
});

