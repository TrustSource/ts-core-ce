/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The `update*VersionLicense` methods role-check every call.
//
// The internal component REST endpoints (and the crawler license back-fill they
// ran through these methods with no connection and no user) are gone, so there
// is no unscoped server-internal path left: a call without a connection is
// refused like any other call without a component manager.
//
// The modules under test are the shipped files, loaded through loadMeteorModule
// with recording stand-ins.
// ---------------------------------------------------------------------------
const _ = require('underscore');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const QOS = loadMeteorModule('imports/lib/component/QOS.js', {'underscore': _}).default;

const COMPANY = 'company-own';
const COMPONENT_ID = 'SQ4fkkFPPgsswKqQZ';
const VERSIONS = ['1.0.0', '2.0.0'];
const LICENSE = {key: 'MIT', name: 'MIT License', url: 'https://opensource.org/licenses/MIT'};

// What a Meteor.callAsync from server code runs as.
const SERVER_INTERNAL = {connection: null, userId: null};

function clientCall(userId) {
  return {connection: {id: 'ddp-session-1'}, userId: userId};
}

class MeteorError extends Error {
  constructor(error, reason) {
    super(reason);
    this.error = error;
    this.reason = reason;
  }
}

const USERS = {
  'u-developer': {_id: 'u-developer', profile: {companyId: COMPANY}},
  'u-company-cm': {_id: 'u-company-cm', profile: {companyId: COMPANY}}
};

const GRANTS = {
  'u-company-cm': ['company_component_manager']
};

function recordingCollection() {
  const updates = [];
  return {
    updates: updates,
    allow: function () {},
    after: {insert: function () {}, update: function () {}},
    find: function () { return {fetchAsync: async function () { return []; }}; },
    findOneAsync: async function () { return undefined; },
    updateAsync: async function (selector, modifier) {
      updates.push({selector: selector, modifier: modifier});
      return 1;
    }
  };
}

function sharedDeps(methods) {
  return {
    'meteor/meteor': {
      Meteor: {
        isServer: true,
        Error: MeteorError,
        methods: function (defs) { Object.assign(methods, defs); },
        publish: function () {},
        startup: function () {},
        users: {findOneAsync: async function (id) { return USERS[id]; }},
        userAsync: async function () { return undefined; }
      }
    },
    'meteor/alanning:roles': {
      Roles: {
        userIsInRole: async function (userId, roles) {
          const wanted = [].concat(roles);
          return (GRANTS[userId] || []).some(function (role) { return wanted.indexOf(role) !== -1; });
        }
      }
    },
    'underscore': _,
    '/imports/lib/component/QOS': {default: QOS},
    '/imports/lib/collections/cves': {default: recordingCollection()},
    '/imports/server/ServerUtils': {default: {makeRawCollection: function () { return {}; }}}
  };
}

function loadComponents() {
  const methods = {};
  const collection = recordingCollection();
  loadMeteorModule('imports/server/collections/components.js', Object.assign(sharedDeps(methods), {
    '/imports/lib/component/criticalPackageFacets': {packageTypeFacetQuery: function () { return null; }},
    'meteor/meteorhacks:search-source': {SearchSource: {defineSource: function () {}}},
    '/imports/lib/collections/components': {default: collection},
    '/imports/lib/security/searchRegex': require('../../imports/lib/security/searchRegex'),
    '/imports/server/rest-api/RestApi.js': {default: {}}
  }));
  return {methods: methods, collection: collection};
}

function loadCots() {
  const methods = {};
  const collection = recordingCollection();
  loadMeteorModule('imports/server/collections/cotsComponents.js', Object.assign(sharedDeps(methods), {
    '/imports/lib/mongoId': {idSelector: function (id) { return {_id: id}; }},
    '/imports/lib/collections/cotsComponents': {default: collection}
  }));
  return {methods: methods, collection: collection};
}

function loadInfrastructure() {
  const methods = {};
  const collection = recordingCollection();
  loadMeteorModule('imports/server/collections/infrastructureComponents.js', Object.assign(sharedDeps(methods), {
    '/imports/lib/mongoId': {idSelector: function (id) { return {_id: id}; }},
    '/imports/lib/collections/infrastructureComponents': {default: collection},
    '/imports/lib/collections/cotsComponents': {default: recordingCollection()}
  }));
  return {methods: methods, collection: collection};
}

// The per-version writes, in call order, without the trailing `updated` stamp.
function versionWrites(collection) {
  return collection.updates.filter(function (u) {
    return u.modifier.$set && u.modifier.$set['versions.$.licenses'];
  });
}

const SUBJECTS = [
  {label: 'Component', method: 'updateVersionLicense', load: loadComponents},
  {label: 'COTSComponent', method: 'updateCOTSComponentVersionLicense', load: loadCots},
  {label: 'InfrastructureComponent', method: 'updateInfrastructureComponentVersionLicense',
    load: loadInfrastructure}
];

describe('version-license methods refuse callers without a component role', function () {
  SUBJECTS.forEach(function (subject) {
    describe(subject.label + ' - ' + subject.method, function () {
      it('a server-internal call (no connection, no user) is refused', async function () {
        const {methods, collection} = subject.load();
        const handler = methods[subject.method];
        expect(typeof handler).toBe('function');

        await expect(handler.call(SERVER_INTERNAL, COMPONENT_ID, VERSIONS, [LICENSE], null, 'System'))
          .rejects.toMatchObject({error: 403});
        expect(collection.updates).toHaveLength(0);
      });

      it('a client call from a user without a component role is refused', async function () {
        const {methods, collection} = subject.load();
        await expect(methods[subject.method].call(clientCall('u-developer'),
          COMPONENT_ID, VERSIONS, [LICENSE], null, 'someone'))
          .rejects.toMatchObject({error: 403});
        expect(collection.updates).toHaveLength(0);
      });

      it('a client call with no user is refused', async function () {
        const {methods, collection} = subject.load();
        await expect(methods[subject.method].call(clientCall(null),
          COMPONENT_ID, VERSIONS, [LICENSE], null, 'someone'))
          .rejects.toMatchObject({error: 403});
        expect(collection.updates).toHaveLength(0);
      });

      it('a company_component_manager client call writes, unscoped', async function () {
        const {methods, collection} = subject.load();
        await methods[subject.method].call(clientCall('u-company-cm'),
          COMPONENT_ID, ['1.0.0'], [LICENSE], null, 'cm');
        expect(versionWrites(collection).map(function (w) { return w.selector; }))
          .toEqual([{'_id': COMPONENT_ID, 'versions.version': '1.0.0'}]);
      });
    });
  });
});
