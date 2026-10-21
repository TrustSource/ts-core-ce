// Per-screen guidance: the steps the guide panel lists and the guided tour
// walks through. One definition per screen, shared by both, so the panel and
// the tour cannot drift apart.
//
// Meteor-free CommonJS so Jest can require it directly
// (test_api/specs/tour-guides.unit.spec.js).
//
// A step without `selector` is an introduction: the tour shows it centred and
// the panel lists it as plain text. `position` is the tour's preferred tooltip
// side (see placement.js).

const GUIDES = {
  welcome: {
    title: 'Getting started',
    summary: 'This will show you around and shortly explain what to find where.',
    steps: [
      {
        selector: '.intro-navigation',
        title: 'Navigation',
        text: 'Depending on your role, you will find here the entities you manage, such as projects, ' +
          'portfolios or modules. From here you also reach the reports and individual scans.',
        position: 'right'
      },
      {
        selector: '.intro-content',
        title: 'Overview',
        text: 'This is where you assess and manage your open source.',
        position: 'right'
      },
      {
        selector: '.intro-knowledge',
        title: 'Knowledge',
        text: 'Background information on components, licenses and open source suites, ' +
          'also called infrastructure components.',
        position: 'right'
      },
      {
        selector: '.intro-settings',
        title: 'Administration',
        text: 'Update company settings, users and API keys, view the company log and configure integrations.',
        position: 'right'
      },
      {
        selector: '.intro-breadcrumb',
        title: 'Breadcrumb',
        text: 'Shows where you are. Use the levels for direct navigation.',
        position: 'bottom'
      },
      {
        selector: '.intro-guide',
        title: 'Guide',
        text: 'Opens the guidance for the screen you are on, next to the page. Start this tour again from there.',
        position: 'left'
      },
      {
        selector: '.intro-messages',
        title: 'Messages',
        text: 'System messages and alerts.',
        position: 'left'
      },
      {
        selector: '.intro-support',
        title: 'Help',
        text: 'Opens the documentation: methods and tools, support and guides for particular tasks.',
        position: 'left'
      },
      {
        selector: '.intro-documentation',
        title: 'API documentation',
        text: 'The documentation of the API. You can try the calls here.',
        position: 'left'
      },
      {
        selector: '.intro-signout',
        title: 'Sign out',
        text: 'Ends your session. Signing in issues a token that keeps you signed in for quite a while, ' +
          'so sign out when you are done.',
        position: 'left'
      }
    ]
  },

  dependency: {
    title: 'Module',
    summary: 'The analysis of one module: its components, their licenses and vulnerabilities, and what to do about them.',
    steps: [
      {
        selector: '.intro-dependency-actions',
        title: 'Module actions',
        text: 'Configure settings and switch types of analysis on or off, run a new analysis, initiate an ' +
          'approval (Manager role), add components manually, tag an analysis, resolve via a notice file ' +
          'and subscribe to updates.',
        position: 'bottom'
      },
      {
        selector: '.intro-dependency-views',
        title: 'Analysis and views',
        text: 'Select an analysis, or switch between the dependency list (default), the legal view ' +
          '(grouped by license), the components view and the dependency structure.',
        position: 'bottom'
      },
      {
        selector: '.intro-dependency-stats',
        title: 'Statistics',
        text: 'Current warnings and violations for legal, vulnerabilities, viability and age (versions). ' +
          'Hover the Stats button for the overview chart.',
        position: 'bottom'
      },
      {
        selector: '.intro-dependency-filters',
        title: 'Filters',
        text: 'Filter by status or component name, select several components for bulk settings ' +
          '(see also the page selector).',
        position: 'bottom'
      },
      {
        selector: '.intro-dependency-components',
        title: 'Components',
        text: 'All components, transitive ones included, as a flat list with the state of each analysis: ' +
          'vulnerabilities, legal compliance, viability and version (if active). Select one to manage it.',
        position: 'right'
      },
      {
        selector: '.intro-dependency-aside',
        title: 'Component details',
        text: 'Details of the selected component. Several occurrences, even of different versions, are ' +
          'handled separately. Shows obligations, status and history, comments, license selection, ' +
          'vulnerability exceptions and component specific settings such as binding or modification.',
        position: 'left'
      },
      {
        selector: '.intro-dependency-pages',
        title: 'Paging',
        text: 'Adjust the number of items per page, browse the pages and see the total number of items ' +
          '(or the effect of a filter).',
        position: 'top'
      }
    ]
  }
};

// Which guide belongs to which route. Every module tab renders the same header
// (actions, views, stats), so they all share the module guide; steps whose
// element is not on the current tab are skipped by the tour and marked in the
// panel.
const ROUTE_GUIDES = {
  dashboard: 'welcome',
  moduleDependencies: 'dependency',
  moduleLicenses: 'dependency',
  moduleComponents: 'dependency',
  moduleVulnerability: 'dependency',
  moduleGraphs: 'dependency'
};

function guideIdForRoute(routeName) {
  return Object.prototype.hasOwnProperty.call(ROUTE_GUIDES, routeName) ? ROUTE_GUIDES[routeName] : null;
}

function getGuide(id) {
  return Object.prototype.hasOwnProperty.call(GUIDES, id) ? GUIDES[id] : null;
}

module.exports = {GUIDES, ROUTE_GUIDES, guideIdForRoute, getGuide};
