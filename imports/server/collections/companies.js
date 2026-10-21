import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Utils from '/imports/server/ServerUtils';
import UserExtUtils from '/imports/lib/userExtUtils';
import Companies from '/imports/lib/collections/companies';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import Approves from '/imports/lib/collections/approves';
import ApprovalReports from '/imports/lib/collections/approvalReports';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import SBOMs from '/imports/lib/collections/sboms';
import SbomFiles from '/imports/lib/collections/sbomFiles';
import uuid from 'uuid';
import {moment} from 'meteor/momentjs:moment';
import _ from 'underscore';
import VEX, {PUBLIC_VEX_CONFIDENCE} from '/imports/lib/converter/vex';
import Signature from '/imports/lib/models/signature';
import countryList from 'country-list';
import {readJson} from '/imports/server/storage/fileStorage';
import {NOTICE_FILES_FOLDER} from '/imports/server/storage/storagePaths';
import {COMPANY_SECRET_EXCLUDE} from '/imports/server/security/companySecretFields';
import {encrypt, decrypt, hmac, hmacCandidates, maskKey} from '/imports/lib/crypto';
import {needsApiKeyUpgrade, upgradeApiKeyEntry, upgradeApiKeysIfNeeded} from '/imports/server/security/apiKeyUpgrade';
import {encodeIdMap} from '/imports/server/csaf/productId';
import {approvalReportSelector} from '/imports/lib/interactors/projects/vulnerabilityLive';
import {requestLogModifier} from '/imports/lib/companies/publicKeyRequests';
import {PRIVATE_ALGORITHM_ROLES} from '/imports/lib/company/settingsAccess';
import {createReleaseKey} from '/imports/server/releaseKeys';
import {newPublicKeyEntry, presentedKeyHashes, withoutSecret, revealPublicKey} from '/imports/server/security/publicKeys';

const NO_COMPANY = 'no company defined'
const ACCESS_DENIED = 'Access Denied'
const TOO_MUCH_UPDATES = 'too much updates'
const RESOURCE_NF = 'Resource not found: '
const NOT_DETECTED = 'Not detected'
const CSAF_TLP_LEVELS = ['WHITE', 'GREEN', 'AMBER', 'RED']
const CSAF_KEY_ROLES = ['account_admin', 'company_security_manager']
const STORE_SIGNATURE = 'Signatures.create'

// Public-key / realm / api-key lookups match a client value directly in a Mongo
// selector. The value MUST be a non-empty string - an object like {$ne:null}
// would match an arbitrary tenant's record (operator injection: cross-tenant
// read of published BoM/Notice/Release docs, or theft of a published API key).
function assertKeyString(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Meteor.Error(400, 'Invalid key');
  }
}

// The published release key a presented (plaintext) key belongs to, found by its
// HMAC: keys are stored encrypted (imports/server/security/publicKeys.js).
async function findPublishedReleaseKey(presented) {
  const hashes = presentedKeyHashes(presented);
  const companyItem = await Companies.findOneAsync(
    {publicReleaseKeys: {$elemMatch: {keyHash: {$in: hashes}, published: true}}},
    {fields: {publicReleaseKeys: 1}});
  const entry = companyItem && _.find(companyItem.publicReleaseKeys, function (item) {
    return hashes.indexOf(item.keyHash) > -1 && item.published === true && !item.unpublished;
  });
  return entry || null;
}

// A release key of the caller's own company, by its non-secret id (the pages).
async function ownReleaseKey(user, id) {
  assertKeyString(id);
  const companyItem = await Companies.findOneAsync(
    {_id: user.profile.companyId, 'publicReleaseKeys.id': id}, {fields: {'publicReleaseKeys.$': 1}});
  const entry = companyItem && companyItem.publicReleaseKeys && companyItem.publicReleaseKeys[0];
  if (!entry) {
    throw new Meteor.Error(404, RESOURCE_NF + id);
  }
  return entry;
}

function hasReleaseScope(entry, scope) {
  return !!entry && (!entry.scope || entry.scope.length === 0 || entry.scope.indexOf(scope) > -1);
}

async function saveReleaseKeyRequest(presented, remoteAddress) {
  assertKeyString(presented);
  await Companies.updateAsync(
    {publicReleaseKeys: {$elemMatch: {keyHash: {$in: presentedKeyHashes(presented)}, published: true}}},
    requestLogModifier('publicReleaseKeys', remoteAddress || NOT_DETECTED));
}

// Preview of a release file on the release keys page: a signed-in member of the
// owning company, by key id.
async function previewReleaseKey(id) {
  const user = await Meteor.userAsync();
  if (!user || !user.profile || !user.profile.companyId) {
    throw new Meteor.Error(403, ACCESS_DENIED);
  }
  return withoutSecret(await ownReleaseKey(user, id));
}

// The public-key serving methods (publicBoMKey/publicNoticeKey/publicVexKey .getFile) receive a server-resolved key RECORD whose selector-bound
// fields are stored strings, NOT a raw key string. They are INTERNAL_METHODS
// (security-guard.js), so a client cannot call them directly; they run from the
// public REST routes and nested under the *.preview methods. As a floor under
// that gate, each field that flows into a Mongo selector must be validated as a
// plain string (or absent) to block operator injection like {releaseId:{$ne:null}}
// turning the lookup into a cross-tenant SBOM/Notice read.
function assertKeyObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Meteor.Error(400, 'Invalid key');
  }
}
function assertStringField(obj, field) {
  if (obj[field] != null && typeof obj[field] !== 'string') {
    throw new Meteor.Error(400, 'Invalid key');
  }
}

// The public REST routes run with no user and are bound by the key record; a
// signed-in caller (the release keys page preview) only gets its own company's
// release files.
function isOwnCompany(user, companyId) {
  return !!(user.profile && user.profile.companyId && user.profile.companyId === companyId);
}
async function releaseHiddenFromCaller(releaseId) {
  const user = await Meteor.userAsync();
  if (!user) {
    return false;
  }
  const approve = await Approves.findOneAsync(releaseId, {fields: {companyId: 1}});
  return !approve || !isOwnCompany(user, approve.companyId);
}

// Minting a key is not idempotent. Two things replay
// that one intent:
//   * a second submit while the first is still in flight (the modal stays open
//     the whole time), and
//   * Meteor itself - the DDP client re-sends every outstanding method call
//     after a dropped connection (ddp-client MethodInvoker.sendMessage), so a
//     blip while the call is outstanding runs `apiKey.create` a second time.
// Both used to produce two identical keys. A `requestId` marks one intent: the
// push is conditional on that marker being absent, and a replay returns the
// entry the first run created.
//
// The caller's token is namespaced with their user _id so a token chosen by one
// user can never address another user's marker (createApiKeyByUser is open to
// every logged-in user, and its entries are personal keys).
function keyRequestId(user, params) {
  const token = params && params.requestId;
  if (typeof token !== 'string' || !token.length || token.length > 64) {
    // No usable token (old client, REST caller, server-internal call): fall back
    // to a fresh one, which is unique per call - i.e. the previous behaviour.
    return user._id + ':' + uuid.v4();
  }
  return user._id + ':' + token;
}

async function findKeyByRequestId(companyId, requestId) {
  const company = await Companies.findOneAsync({_id: companyId, 'apiKeys.requestId': requestId},
    {fields: {apiKeys: 1}});
  return company && _.find(company.apiKeys, function (item) {
    return item.requestId === requestId;
  });
}

Meteor.publish('company', async function () {
  const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
  if (companyId) {
    // Own-company doc: exclude every secret via the centralized set.
    // `statistics` is excluded, not
    // sliced: a `{$slice}` projection operator is unsupported by Minimongo's
    // projection compiler, which Meteor 3's reactive observe driver
    // (ChangeStreamObserveDriver) runs on every publish cursor - it throws
    // "Minimongo doesn't support operators in projections yet" and kills the
    // whole publication. Nothing reads the published statistics reactively (the
    // dashboard reads company.statistics via the getCompanyCurrent method /
    // Session), so drop it from the wire entirely rather than trim it.
    return Companies.find(companyId, {fields: Object.assign({}, COMPANY_SECRET_EXCLUDE, {statistics: 0})});
  }
  this.ready();
});

// Account_admin gets the full company doc (settings, integrations) EXCEPT
// the actual REST API-key secret material - apiKeys[].key/keyHash. Everything
// else on an apiKeys entry (id, name, scope, published, unpublished, deleted,
// externalId, lastUsedDate, created, userId, maskedKey) keeps flowing so the
// settings UI can still list/manage keys - it just never sees the secret used
// to authenticate, matching the show-once/reveal-on-demand pattern (apiKey.reveal).
//
// `externalApiKeys` held per-company service keys, no longer used. Nothing reads
// it any more; it stays excluded because existing
// company documents may still carry those credentials.
const COMPANY_FULL_SECRET_EXCLUDE = {
  'apiKeys.key': 0,
  'apiKeys.keyHash': 0,
  'publicReleaseKeys.key': 0,
  'publicReleaseKeys.keyHash': 0,
  'publicCsafKeys.key': 0,
  'publicCsafKeys.keyHash': 0,
  externalApiKeys: 0
};

// The CSAF feed keys page is open to every CSAF_KEY_ROLES role, but companyFull
// only to the Account admin, so a Company security manager saw an empty list.
// The roles a company API key may be scoped to: a non-empty list of known roles.
function validApiKeyScope(scope) {
  const known = UserExtUtils.availableRolesKeys();
  if (!Array.isArray(scope) || !scope.length ||
    !scope.every((role) => typeof role === 'string' && known.indexOf(role) > -1)) {
    throw new Meteor.Error(400, 'An API key needs at least one valid scope');
  }
  return _.uniq(scope);
}

Meteor.publish('companyCsafKeys', async function () {
  const user = this.userId && await Meteor.users.findOneAsync(this.userId, {fields: {profile: 1}});
  const companyId = user && user.profile && user.profile.companyId;
  if (companyId && await Roles.userIsInRoleAsync(this.userId, CSAF_KEY_ROLES, companyId)) {
    // Everything the page shows; the key itself and its hash stay on the server.
    return Companies.find(companyId, {fields: {
      'publicCsafKeys.id': 1, 'publicCsafKeys.name': 1, 'publicCsafKeys.maskedKey': 1,
      'publicCsafKeys.tlpLevels': 1, 'publicCsafKeys.operations': 1, 'publicCsafKeys.published': 1,
      'publicCsafKeys.created': 1, 'publicCsafKeys.requests': 1, 'publicCsafKeys.requestCount': 1
    }});
  }
  this.ready();
});

Meteor.publish('companyFull', async function () {
  const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
  const user = await Meteor.users.findOneAsync(this.userId);
  if (companyId && await Roles.userIsInRole(this.userId, 'account_admin', user.profile.companyId)) {
    // Self-heal any legacy apiKeys entry (genuinely plaintext
    // key, no id/keyHash/maskedKey) BEFORE returning the cursor, so the
    // settings UI's masked-view column and the copy button's data-id resolve
    // correctly on first load - no operator-run TS_REENCRYPT_SECRETS
    // required. Cheap no-op once a company's keys have all been touched once.
    const companyForUpgrade = await Companies.findOneAsync(companyId, {fields: {apiKeys: 1}});
    if (companyForUpgrade && companyForUpgrade.apiKeys && companyForUpgrade.apiKeys.some(needsApiKeyUpgrade)) {
      await upgradeApiKeysIfNeeded(companyId, companyForUpgrade.apiKeys);
    }
    // `statistics: 0` (exclude), NOT `{$slice: -1}`: a projection operator is
    // unsupported by Minimongo's projection compiler, which Meteor 3's reactive
    // observe driver runs on every publish cursor - it throws "Minimongo doesn't
    // support operators in projections yet" and kills the whole companyFull
    // publication, so the account_admin settings UI (API keys page) gets no
    // company doc at all and shows an empty list. Nothing reads the published
    // statistics reactively (dashboard uses the getCompanyCurrent method).
    return Companies.find(companyId,
      {fields: Object.assign({}, COMPANY_FULL_SECRET_EXCLUDE, {statistics: 0})});
  }
  this.ready();
});

// No client write path: every company change goes through a Companies.* method
// that checks the caller's role and strips protected fields. A client-side
// Companies.update could otherwise set API keys, release-key bindings or
// integration URLs directly.
Companies.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

Meteor.methods({
  getApiKeysByUser: async function () {
    const userId = this.userId
    const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
    if (companyId) {
      const company = await Companies.findOneAsync(companyId, {fields: {apiKeys:1}});
      if (!company || !company.apiKeys) return [];
      const myKeys = company.apiKeys.filter(apiKey => {
        return apiKey.userId === userId && !apiKey.deleted;
      });
      // This is the personal-keys page's (profile.js) sole
      // data source - it does not go through the companyFull publication, so
      // it needs its OWN self-heal for a legacy (no id/maskedKey)
      // personal key, same rationale as companyFull.
      const upgraded = await upgradeApiKeysIfNeeded(companyId, myKeys);
      // This method returns directly to the client (not a publication -
      // no automatic field-exclusion projection applies), so the secret
      // key/keyHash must be stripped here the same way every other
      // client-facing return in this file is (apiKey.create/update,
      // createApiKeyByUser/updateApiKeyByUser, apiKey.one).
      return upgraded.map(apiKey => _.omit(apiKey, 'key', 'keyHash'))
    }
    return [];
  },
  createApiKeyByUser: async function (params) {
    const user = await Meteor.userAsync();
    if (!user) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(400, NO_COMPANY);
    }
    const userRoles = await Roles.getRolesForUserAsync(user, {scope: user.profile.companyId});
    // Same replay protection as apiKey.create - see keyRequestId above.
    const requestId = keyRequestId(user, params);
    const replayed = await findKeyByRequestId(user.profile.companyId, requestId);
    if (replayed) {
      return _.omit(replayed, 'key', 'keyHash');
    }
    // The secret is generated once, stored encrypted, and never returned
    // to the client - only its non-secret id/maskedKey/metadata are.
    const plainKey = uuid.v4();
    let object = {
      created: new Date(),
      id: uuid.v4(),
      key: encrypt(plainKey),
      keyHash: hmac(plainKey),
      maskedKey: maskKey(plainKey),
      name: Utils.username(user) || (params && params.name) || '',
      scope: userRoles,
      userId: user._id,
      requestId: requestId
    };
    let updateCnt = await Companies.updateAsync(
      {_id: user.profile.companyId, 'apiKeys.requestId': {$ne: requestId}},
      {$push: {apiKeys: object}});
    if (updateCnt !== 1) {
      const raced = await findKeyByRequestId(user.profile.companyId, requestId);
      if (raced) {
        return _.omit(raced, 'key', 'keyHash');
      }
      throw new Meteor.Error(500, TOO_MUCH_UPDATES);
    }
    return _.omit(object, 'key', 'keyHash');
  },
  updateApiKeyByUser: async function (apiKey) {
    delete apiKey.index;
    const user = await Meteor.userAsync();
    if (!user || apiKey.userId !== user._id) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(400, NO_COMPANY);
    }
    const company = await Companies.findOneAsync(user.profile.companyId, {fields: {statistics: 0}});
    // The client no longer receives the secret `key`, so identity is now
    // the non-secret `id` (generated once at creation, immutable).
    let apiKeys = _.map(company.apiKeys, function (item) {
      // Only the owner may update their own personal key, and its scope/identity/
      // secret fields are immutable from the client - otherwise a non-admin could
      // escalate the key's REST permissions, tamper with a colleague's key, or
      // (since the client object no longer carries them) null out the secret on
      // a metadata-only edit (rename/publish/unpublish/delete).
      if (item.id === apiKey.id && item.userId === user._id) {
        return Object.assign({}, apiKey, {
          scope: item.scope,
          userId: item.userId,
          key: item.key,
          keyHash: item.keyHash,
          maskedKey: item.maskedKey,
          id: item.id,
          created: item.created,
          // Server-owned like the fields above - a rename must not erase
          // the idempotency marker the entry was created under.
          requestId: item.requestId
        });
      }
      return item
    });
    await Companies.updateAsync(user.profile.companyId, {$set: {apiKeys: apiKeys}});
    return _.omit(apiKey, 'key', 'keyHash');
  },
  getCompanyCurrent: async function () {
    const user = await Meteor.userAsync();
    if(user && user.profile){
      // Method returns are NOT covered by publication field-exclusions; this is
      // called by every logged-in user (→ Session.set('company')). Use the
      // centralized secret set (incl. publicCsafKeys).
      return await Companies.findOneAsync(user.profile.companyId, {fields: COMPANY_SECRET_EXCLUDE});
    }
    return false
  },
  getModulesHistory: async function (companyId) {

    function computeCompareDate(deltaUnit, date) {
      return moment(date || new Date()).subtract(1, deltaUnit).toDate();
    }

    function selectDeltaUnit(company) {
      if (company && company.statistics && company.statistics[0]) {
        const firstDate = company.statistics[0].date;
        const firstMoment = moment(firstDate);
        const dayDiff = -firstMoment.diff(new Date(), 'days');
        //console.log('getModulesHistory().selectDeltaUnit(): dayDiff=', dayDiff, company);
        const longOrMedium = dayDiff > 84 ? 'months' : 'weeks';
        return dayDiff < 13 ? 'days' : longOrMedium;
      }
      return 'days'; // default
    }

    const user = await Meteor.userAsync();
    // A logged-in (DDP) caller may only read their own company; the companyId
    // argument is reserved for trusted server/REST calls (no DDP user).
    const cid = user ? (user.profile && user.profile.companyId) : companyId;
    if (!cid) {
      throw new Meteor.Error(500, NO_COMPANY);
    }

    const company = await Companies.findOneAsync(cid);
    const MAX_ENTRIES = 12;
    const DELTA_UNIT = selectDeltaUnit(company);
    const history = [];

    if (company && company.statistics && company.statistics.length) {
      let historyIdx = 0;
      let compareDate = computeCompareDate(DELTA_UNIT);
      for (let i = company.statistics.length - 1; i >= 0 && historyIdx < MAX_ENTRIES; i--) {
        const stat = company.statistics[i];
        if (stat.date < compareDate) {
          history[historyIdx++] = stat;
          compareDate = computeCompareDate(DELTA_UNIT, compareDate);
        }
      }
    }
    return {
      unit: DELTA_UNIT,
      history: history
    };
  },


  updateCompanyStatistics: async function (companyId) {
    /**
     * Compute the statistics for all modules of the company belonging to actual module
     */
    // A logged-in (DDP) caller may only recompute their own company's stats;
    // the companyId argument is reserved for trusted server/REST calls.
    const statsUser = await Meteor.userAsync();
    if (statsUser) {
      companyId = statsUser.profile && statsUser.profile.companyId;
    }
    const date = new Date();
    const companyStats = {
      date: date,
      modules: {
        warnings: 0,
        violations: 0,
        total: 0
      },
      components: {
        warnings: 0,
        violations: 0,
        total: 0
      },
      licenses: {
        warnings: 0,
        violations: 0,
        total: 0
      }
    };
    if (companyId) {
      const modules = await Modules.find({companyId: companyId}).fetchAsync();
      for (const module of modules) {
        const analysis = module && await module.getAnalysisAsync();
        const filter = analysis && analysis._id || null;
        const projStats = module && module.getStatistics(filter);
        if (projStats) {
          switch (projStats.getState()) {
          case 'warnings':
            companyStats.modules.warnings++;
            break;
          case 'violations':
            companyStats.modules.violations++;
            break;
          }
          companyStats.modules.total++;
          ['legal', 'vulnerability', 'viability', 'integrity'].forEach(key => {
            companyStats.components.warnings += projStats[key].warnings;
            companyStats.components.violations += projStats[key].violations;
          });
          companyStats.components.total += projStats.components;
        }
        if (analysis && typeof analysis.getLicenses == 'function') {
          //console.log('computeStatistics() module: %s licenses: %d', module.name, analysis.getLicenses().length);
          analysis.getLicenses().forEach(license => {
            //console.log('   license: %s l', license.name, license.key, license.rating && license.rating.totalRating);
            if (license.key) {
              companyStats.licenses.total++;
              if (license.rating) {
                const state = Utils.Rating.getState(license.rating.totalRating);
                switch (state) {
                case 'warnings':
                  companyStats.licenses.warnings++;
                  break;
                case 'violations':
                  companyStats.licenses.violations++;
                  break;
                }
              }
            }
          });
        }
      }
    }
    const statistics = companyStats;

    const startDate = moment(statistics.date);
    startDate.set('hour', 0).set('minute', 0).set('second', 0).set('millisecond', 0);
    const endDate = startDate.clone().add(1, 'days');

    const currentDateQuery = {
      _id: companyId,
      'statistics.date': {$gte: startDate.toDate(), $lt: endDate.toDate()}
    };

    let currentDateExists = true;
    let company = await Companies.findOneAsync(currentDateQuery);

    if (!company) {
      currentDateExists = false;
      delete currentDateQuery['statistics.date'];
      company = await Companies.findOneAsync(currentDateQuery);
    }
    if (!company) return;

    if (currentDateExists) {           // update overwrite date statistics record
      await Companies.updateAsync(currentDateQuery, {$set: {'statistics.$': statistics}});
    } else {                            // push a new date statistics record
      await Companies.updateAsync(currentDateQuery, {$push: {'statistics': {$each: [statistics], $slice: -100}}});
    }
  },

  // The SBOM side of a release key (scope 'sbom', or no scope). The publicBoMKey.*
  // names are historical: the deprecated public-BoM keys they once also served are gone.
  'publicBoMKey.one': async function (key) {
    assertKeyString(key);
    const entry = await findPublishedReleaseKey(key);
    if (!entry) {
      throw new Meteor.Error(404, 'Release key not found');
    }
    return hasReleaseScope(entry, 'sbom') ? withoutSecret(entry) : undefined;
  },

  'publicBoMKey.saveRequest': async function (key, remoteAddress) {
    await saveReleaseKeyRequest(key, remoteAddress);
  },

  'publicBoMKey.getFile': async function (key) {
    assertKeyObject(key);
    assertStringField(key, 'releaseId');
    // Never run an unbound lookup: without a release there is no SBOM to serve.
    if (!key.releaseId) {
      return {'error': 'SBOM file not found'};
    }
    if (await releaseHiddenFromCaller(key.releaseId)) {
      return {'error': 'SBOM file not found'};
    }
    const filter = {
      approveId: key.releaseId
    }
    let sbom = await SBOMs.findOneAsync(filter);
    if(!sbom){
      sbom = await SbomFiles.findOneAsync(filter);
    }
    let file;
    let list = (sbom && sbom.data && sbom.data.list) || (sbom && sbom.list)
    if(list){
      if (sbom.data && sbom.data.project && sbom.data.project.name) {
        file = _.pick(sbom.data.project, 'name', 'description');
      } else {
        const sbomProject = sbom.projectAsync ? await sbom.projectAsync() : sbom.project && sbom.project();
        if (sbomProject) {
          file = _.pick(sbomProject, 'name', 'description');
        } else {
          if (sbom.data && sbom.data.modules && sbom.data.modules[0]) {
            file = _.pick(sbom.data.modules[0], 'name', 'description');
          }
        }
      }
      if(!file){
        file = {
          name: 'REMOVED_PROJECT'
        }
      }
      file.components = list
      let signature = await Signature.get(file)
      file.signatures = [signature]
      await Meteor.callAsync(STORE_SIGNATURE, {signature, type:'SbomFiles'})
    }
    return file ? file : {'error': 'SBOM file not found'};
  },

  'publicBoMKey.preview': async function (id) {
    return await Meteor.callAsync('publicBoMKey.getFile', await previewReleaseKey(id));
  },

  'privateLicenses.create': async function (key, description) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    let object = {
      key: key || 'COMMERCIAL',
      description,
      author: Utils.username(user),
      created: new Date()
    };
    let updateCnt = await Companies.updateAsync(user.profile.companyId,
      {$push: {privateLicenses: object}});
    if (updateCnt !== 1) {
      throw new Meteor.Error(500, TOO_MUCH_UPDATES);
    }
    return object;
  },

  'privateLicenses.delete': async function (key) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    await Companies.updateAsync(user.profile.companyId, {$pull: {privateLicenses: {key: key}}});
  },

  'privateLicenses.usageStats': async function () {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    const company = await Companies.findOneAsync(user.profile.companyId, {fields: {privateLicenses: 1}});
    if (company && company.privateLicenses) {
      for (let i = 0; i < company.privateLicenses.length; i++) {
        company.privateLicenses[i].analysisCount = await ModuleAnalysis.find(
          {companyId:user.profile.companyId, 'licenses.key':company.privateLicenses[i].key}).countAsync()
      }
    }
    return company.privateLicenses;
  },

  'privateAlgorithms.create': async function (key, strength) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, PRIVATE_ALGORITHM_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    let object = {
      key,
      strength,
      author: Utils.username(user),
      created: new Date()
    };
    let updateCnt = await Companies.updateAsync(user.profile.companyId,
      {$push: {privateAlgorithms: object}});
    if (updateCnt !== 1) {
      throw new Meteor.Error(500, TOO_MUCH_UPDATES);
    }
    return object;
  },

  'privateAlgorithms.delete': async function (key) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, PRIVATE_ALGORITHM_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    await Companies.updateAsync(user.profile.companyId, {$pull: {privateAlgorithms: {key: key}}});
  },

  'blacklistedAlgorithms.add': async function ({key, strength, comment}) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'company_security_manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    let object = {
      key,
      strength,
      comment,
      createdBy: Utils.username(user),
      created: new Date()
    };
    let updateCnt = await Companies.updateAsync(user.profile.companyId,
      {$push: {blacklistedAlgorithms: object}});
    if (updateCnt !== 1) {
      throw new Meteor.Error(500, TOO_MUCH_UPDATES);
    }
    return object;
  },

  'blacklistedAlgorithms.delete': async function (key) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'company_security_manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    await Companies.updateAsync(user.profile.companyId, {$pull: {blacklistedAlgorithms: {key: key}}});
  },

  // The Notice side of a release key (scope 'notice', or no scope). The
  // publicNoticeKey.* names are historical: the deprecated public-Notice keys are gone.
  'publicNoticeKey.one': async function (key) {
    assertKeyString(key);
    const entry = await findPublishedReleaseKey(key);
    if (!entry) {
      throw new Meteor.Error(404, 'Release key not found');
    }
    return hasReleaseScope(entry, 'notice') ? withoutSecret(entry) : undefined;
  },

  'publicNoticeKey.saveRequest': async function (key, remoteAddress) {
    await saveReleaseKeyRequest(key, remoteAddress);
  },

  'publicNoticeKey.getFile': async function (key) {
    assertKeyObject(key);
    assertStringField(key, 'releaseId');
    // Never run an unbound lookup ({} would match an arbitrary tenant's notice).
    if (!key.releaseId) {
      return {'error': 'Notice file not found'};
    }
    if (await releaseHiddenFromCaller(key.releaseId)) {
      return {'error': 'Notice file not found'};
    }
    let noticeFile = await NoticeFiles.findOneAsync({approveId: key.releaseId});
    if (!noticeFile) {
      return {'error': 'Notice file not found'};
    }
    // When fileUrl exists, licenses are stored in the notice file on local storage, not in MongoDB
    if (noticeFile.fileUrl) {
      try {
        const fileData = await readJson({
          companyId: noticeFile.companyId,
          folder: NOTICE_FILES_FOLDER,
          name: noticeFile.fileUrl.split('/').pop()
        });
        if (fileData && fileData.licenses) {
          noticeFile.licenses = fileData.licenses;
        }
      } catch (e) {
        console.log('publicNoticeKey.getFile storage error:', e);
      }
    }
    let file = {licenses: noticeFile.licenses ? noticeFile.licenses : []}
    let signature = await Signature.get(file)
    file.signatures = [signature]
    await Meteor.callAsync(STORE_SIGNATURE, {signature, type:'NoticeFiles'});
    return file;
  },

  'publicNoticeKey.preview': async function (id) {
    return await Meteor.callAsync('publicNoticeKey.getFile', await previewReleaseKey(id));
  },

  'getCompanyFoss': async function (companyId) {
    const user = await Meteor.userAsync();
    // DDP callers only see their own company's FOSS settings; the companyId
    // argument is for trusted server/REST calls (no DDP user).
    const cid = user ? (user.profile && user.profile.companyId) : companyId;
    if (!cid) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    let company = await Companies.findOneAsync(cid);
    return company ? company.foss : null
  },

  'getCompanyAccountAdmin': async function () {
    const user = await Meteor.userAsync();
    if(user && user.profile){
      let company = await Companies.findOneAsync(user.profile.companyId);
      if(company && company.distribution && company.distribution.email){
        return company.distribution.email
      }
      const adminCursor = await Roles.getUsersInRole(['account_admin'], {scope: user.profile.companyId});
      let users = await adminCursor.fetchAsync();
      if(users.length){
        return getUserEmail(users[0])
      }else{
        const mgrCursor = await Roles.getUsersInRole(['manager'], {scope: user.profile.companyId});
        let users = await mgrCursor.fetchAsync();
        if(users.length){
          return getUserEmail(users[0])
        }
        return false
      }
    }
    return false
  },

  'getCompanyComplianceManager': async function () {
    const user = await Meteor.userAsync();
    if(user && user.profile){
      let company = await Companies.findOneAsync(user.profile.companyId);
      if(company && company.distribution && company.distribution.email){
        return company.distribution.email
      }
      const cmCursor = await Roles.getUsersInRole(['compliance_manager'], {scope: user.profile.companyId});
      let users = await cmCursor.fetchAsync();
      if(users.length){
        return getUserEmail(users[0])
      }else{
        const mgrCursor = await Roles.getUsersInRole(['manager'], {scope: user.profile.companyId});
        let users = await mgrCursor.fetchAsync();
        if(users.length){
          return getUserEmail(users[0])
        }
        return false
      }
    }
    return false
  },

  'apiKey.create': async function (params) {
    const scope = validApiKeyScope(params && params.scope);
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    // One intent = one key. A replay of this call (double submit, or a
    // DDP re-send after a dropped connection) resolves to the entry the first
    // run made instead of minting a second one. See keyRequestId above.
    const requestId = keyRequestId(user, params);
    const replayed = await findKeyByRequestId(user.profile.companyId, requestId);
    if (replayed) {
      return _.omit(replayed, 'key', 'keyHash');
    }
    // The secret is generated once, stored encrypted, and never returned
    // to the client - only its non-secret id/maskedKey/metadata are.
    const plainKey = uuid.v4();
    let object = {
      created: new Date(),
      id: uuid.v4(),
      key: encrypt(plainKey),
      keyHash: hmac(plainKey),
      maskedKey: maskKey(plainKey),
      name: (params && params.name) || '',
      scope: scope,
      requestId: requestId
    };
    // Conditional push: Mongo re-evaluates the selector under the document lock,
    // so of two concurrent replays exactly one can append.
    let updateCnt = await Companies.updateAsync(
      {_id: user.profile.companyId, 'apiKeys.requestId': {$ne: requestId}},
      {$push: {apiKeys: object}});
    if (updateCnt !== 1) {
      // Either the company is gone, or a concurrent replay won the race - in the
      // latter case return its entry rather than reporting a failure the caller
      // would retry into yet another key.
      const raced = await findKeyByRequestId(user.profile.companyId, requestId);
      if (raced) {
        return _.omit(raced, 'key', 'keyHash');
      }
      throw new Meteor.Error(500, TOO_MUCH_UPDATES);
    }
    return _.omit(object, 'key', 'keyHash');
  },

  'apiKey.one': async function (key) {
    assertKeyString(key);
    // Company API keys are account_admin-only. A DDP caller must be account_admin
    // of their own company, and the lookup is scoped to that company so a key
    // object is never resolved cross-tenant. A server-internal call (no DDP
    // connection) is trusted and bypasses the check.
    // Keys are matched by their hash only, as in the REST API; a stored value
    // (ciphertext or a legacy plaintext copy) never works as a key.
    const keyHashes = hmacCandidates(key);
    let selector = {'apiKeys.keyHash': {$in: keyHashes}, 'apiKeys.published': true};
    if (this.connection) {
      const user = await Meteor.userAsync();
      const companyId = user && user.profile && user.profile.companyId;
      if (!user || !companyId || !await Roles.userIsInRole(user, ['account_admin'], companyId)) {
        throw new Meteor.Error(403, ACCESS_DENIED);
      }
      selector._id = companyId;
    }
    const companyItem = await Companies.findOneAsync(selector);
    if (!companyItem) {
      throw new Meteor.Error(404, RESOURCE_NF + key);
    }
    const found = _.find(companyItem.apiKeys, function (apiKey) {
      return keyHashes.indexOf(apiKey.keyHash) > -1 && apiKey.published === true && !apiKey.unpublished
    });
    if (!found) {
      return found;
    }
    // The caller supplied the key, so echoing it back discloses nothing new.
    // keyHash is internal-only, stripped.
    return Object.assign({}, _.omit(found, 'keyHash'), {key});
  },

  'apiKey.update': async function (apiKey) {
    delete apiKey.index;
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    const company = await Companies.findOneAsync(user.profile.companyId, {fields: {statistics: 0}});
    // The client no longer receives the secret `key`, so identity is now
    // the non-secret `id` (generated once at creation, immutable).
    let apiKeys = _.map(company.apiKeys, function (item) {
      // Secret fields are immutable from the client - otherwise a metadata-only
      // edit (rename/publish/unpublish/delete) would null them out, since the
      // client object no longer carries them.
      if (item.id === apiKey.id) {
        return Object.assign({}, apiKey, {
          // A personal key keeps its owner and the owner's roles; a company key's
          // scope may change, but never to none (no scope means no access).
          scope: (item.userId || apiKey.scope === undefined) ? item.scope : validApiKeyScope(apiKey.scope),
          userId: item.userId,
          key: item.key,
          keyHash: item.keyHash,
          maskedKey: item.maskedKey,
          id: item.id,
          created: item.created,
          // Server-owned like the fields above - a rename must not erase
          // the idempotency marker the entry was created under.
          requestId: item.requestId
        });
      }
      return item
    });
    await Companies.updateAsync(user.profile.companyId, {$set: {apiKeys: apiKeys}});
  },

  'apiKey.logActivity': async function (companyId, apiKey) {
    // Internal-only: invoked server-side by the REST layer to stamp key usage.
    // A DDP caller has no business writing another company's apiKeys array.
    if (await Meteor.userAsync()) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    delete apiKey.index;
    const company = await Companies.findOneAsync(companyId, {fields: {statistics: 0}});
    let apiKeys = _.map(company.apiKeys, function (item) {
      // Prefer the non-secret `id` (post-migration entries). A pre-migration
      // entry has no `id` yet - falling back to `id` would match `undefined ===
      // undefined` across every other un-migrated entry in the company and
      // corrupt the array, so those are still matched by `key` (today's
      // behaviour, unchanged) until the migration backfills their `id`.
      const matches = apiKey.id ? item.id === apiKey.id : item.key === apiKey.key;
      return matches ? apiKey : item
    });
    await Companies.updateAsync(companyId, {$set: {apiKeys: apiKeys}});
  },

  'apiKey.reveal': async function (id) {
    // apiKeys[] holds two ownership models: personal keys (created via
    // createApiKeyByUser, `userId` set) and company-wide keys (created via
    // apiKey.create, no `userId`). Only the "must be logged in" half of auth
    // can be resolved up front - which of the two models applies (and
    // therefore who may reveal) is only known once the entry itself is
    // fetched, so the ownership/admin check happens after the lookup below.
    const user = await Meteor.userAsync();
    if (!user) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    assertKeyString(id);
    // Scoped to the caller's OWN company only - covers both "not owned by
    // caller's company" and (via the published/unpublished/deleted check below)
    // "key not currently copyable".
    const companyItem = await Companies.findOneAsync(
      {_id: user.profile.companyId, 'apiKeys.id': id},
      {fields: {'apiKeys.$': 1}});
    const entry = companyItem && companyItem.apiKeys && companyItem.apiKeys[0];
    if (!entry || entry.published !== true || entry.unpublished || entry.deleted) {
      throw new Meteor.Error(404, RESOURCE_NF + id);
    }
    // A personal key (userId set) is revealable ONLY by the owning user - no
    // admin override, mirroring updateApiKeyByUser's strict `item.userId ===
    // user._id` ownership check on this exact same data (an account_admin
    // reading a colleague's personal credential with zero ownership check
    // would be an impersonation/non-repudiation gap: the audit log would only
    // show the admin as actor, not that they accessed someone else's key). A
    // company-wide key (no userId) is revealable only by account_admin.
    const isOwner = !!entry.userId && entry.userId === user._id;
    const isAdminOfCompanyWideEntry = !entry.userId &&
      await Roles.userIsInRole(user, ['account_admin'], user.profile.companyId);
    if (!isOwner && !isAdminOfCompanyWideEntry) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    // Defensive self-heal - an entry matched by id should
    // already be fully migrated (companyFull/getApiKeysByUser upgrade any
    // legacy entry before the client ever sees a real id to submit here),
    // but upgrade in place if this one somehow still needs it, using the
    // exact same shared logic as the batch migration and the other
    // self-healing read paths - one implementation, not a second copy.
    const upgradedEntry = await upgradeApiKeyEntry(user.profile.companyId, entry);
    const plainKey = decrypt(upgradedEntry.key);
    // decrypt() reports BOTH of its failure modes as a bare `undefined`:
    // nothing usable stored under `key`, and a stored `v2:` ciphertext that
    // does not authenticate under the current TS_ENCRYPTION_KEY (secret
    // rotated, introduced after the data was written, or the database was
    // restored from an environment with a different secret). Returning that
    // undefined put the literal nine-character text "undefined" on the user's
    // clipboard behind a "successfully copied" toast, because the copy handler
    // feeds this return value straight into `new Blob([...])`. Fail loudly
    // instead - the two cases are distinguished in the server log only, since
    // which one it is says something about the server's key material.
    if (typeof plainKey !== 'string' || plainKey.length === 0) {
      console.warn('[apiKey.reveal] no plaintext for key', id, 'of company', user.profile.companyId,
        upgradedEntry.key ? '- stored value did not decrypt under the current TS_ENCRYPTION_KEY'
          : '- entry has no stored key value at all');
      throw new Meteor.Error(500, 'This key\'s stored value could not be read back. ' +
        'Create a new key and delete this one.');
    }
    // Server-side, atomic with the reveal - cannot be skipped by a client that
    // calls apiKey.reveal directly without going through the UI's copy button.
    // After the guard above: a reveal that produced no plaintext disclosed
    // nothing, so it must not be recorded as a key disclosure.
    await Meteor.callAsync('logEvent', user, 'Api key '+upgradedEntry.maskedKey+' copied', 'apiKeyProcessing');
    return plainKey;
  },

  'publicReleaseKey.create': async function (releaseId) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    // Only mint a key over a release the caller's company owns; the public
    // serving path resolves releaseId without any company scoping.
    const object = await createReleaseKey(user.profile.companyId, releaseId);
    if (!object) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    return withoutSecret(object);
  },

  'publicReleaseKey.one': async function (key) {
    assertKeyString(key);
    const entry = await findPublishedReleaseKey(key);
    if (!entry) {
      throw new Meteor.Error(404, 'Release key not found');
    }
    return hasReleaseScope(entry, 'csaf') ? withoutSecret(entry) : undefined;
  },

  // The plaintext of a release key, for copying it or building its QR code links.
  'publicReleaseKey.reveal': async function (id) {
    const user = await Meteor.userAsync();
    if (!user || !user.profile || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    const entry = await ownReleaseKey(user, id);
    const plain = revealPublicKey(entry);
    await Meteor.callAsync('logEvent', user, 'Public Release key ' + entry.maskedKey + ' copied', 'publicReleaseKeyProcessing');
    return plain;
  },

  'publicReleaseKey.update': async function (publicReleaseKeyKey) {
    delete publicReleaseKeyKey.index;
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    const company = await Companies.findOneAsync(user.profile.companyId, {fields: {statistics: 0}});
    // Matched by the non-secret id; the client never holds the key itself.
    const stored = _.find(company.publicReleaseKeys || [], function (item) {
      return !!publicReleaseKeyKey && typeof publicReleaseKeyKey.id === 'string' && item.id === publicReleaseKeyKey.id;
    });
    if (!stored) {
      throw new Meteor.Error(404, RESOURCE_NF + (publicReleaseKeyKey && publicReleaseKeyKey.id));
    }
    // The bound release must belong to the caller's company; identity/audit
    // fields are server-owned (never client-mutable).
    await assertOwnsKeyBindings(publicReleaseKeyKey, user.profile.companyId);
    publicReleaseKeyKey.id = stored.id;
    publicReleaseKeyKey.key = stored.key;
    publicReleaseKeyKey.keyHash = stored.keyHash;
    publicReleaseKeyKey.maskedKey = stored.maskedKey;
    publicReleaseKeyKey.created = stored.created;
    publicReleaseKeyKey.requests = Array.isArray(stored.requests) ? stored.requests : [];
    if (typeof stored.requestCount === 'number') {
      publicReleaseKeyKey.requestCount = stored.requestCount;
    } else {
      delete publicReleaseKeyKey.requestCount;
    }
    let publicReleaseKeys = _.map(company.publicReleaseKeys, function (item) {
      return (item.id === stored.id) ? publicReleaseKeyKey : item
    });
    await Companies.updateAsync(user.profile.companyId, {$set: {publicReleaseKeys: publicReleaseKeys}});
  },

  'publicReleaseKey.delete': async function (key) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    assertKeyString(key);
    // `key` is the entry's non-secret id.
    await Companies.updateAsync(user.profile.companyId, {$pull: {publicReleaseKeys: {id: key}}});
  },

  'publicReleaseKey.saveRequest': async function (publicReleaseKeyKey, remoteAddress) {
    await saveReleaseKeyRequest(publicReleaseKeyKey, remoteAddress);
  },

  'publicCsafKey.create': async function (name, tlpLevels) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, CSAF_KEY_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    if (!Array.isArray(tlpLevels) || tlpLevels.length === 0 ||
      !tlpLevels.every(function (l) { return CSAF_TLP_LEVELS.indexOf(l) > -1; })) {
      throw new Meteor.Error(400, 'At least one valid TLP level is required');
    }
    const object = newPublicKeyEntry({
      created: new Date(),
      name: typeof name === 'string' ? name : '',
      tlpLevels: _.uniq(tlpLevels),
      // Hardcoded read-only scope for now; action management comes later.
      operations: ['view'],
      published: true,
      requests: []
    });
    const updateCnt = await Companies.updateAsync(user.profile.companyId,
      {$push: {publicCsafKeys: object}});
    if (updateCnt !== 1) {
      throw new Meteor.Error(500, TOO_MUCH_UPDATES);
    }
    return withoutSecret(object);
  },

  // The plaintext of a CSAF feed key, for copying it.
  'publicCsafKey.reveal': async function (id) {
    const user = await Meteor.userAsync();
    if (!user || !user.profile || !await Roles.userIsInRole(user, CSAF_KEY_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    assertKeyString(id);
    const companyItem = await Companies.findOneAsync(
      {_id: user.profile.companyId, 'publicCsafKeys.id': id}, {fields: {'publicCsafKeys.$': 1}});
    const entry = companyItem && companyItem.publicCsafKeys && companyItem.publicCsafKeys[0];
    if (!entry) {
      throw new Meteor.Error(404, RESOURCE_NF + id);
    }
    const plain = revealPublicKey(entry);
    await Meteor.callAsync('logEvent', user, 'CSAF feed key ' + entry.maskedKey + ' copied', 'publicReleaseKeyProcessing');
    return plain;
  },

  'publicCsafKey.setPublished': async function (key, published) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, CSAF_KEY_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    // `key` is the entry's non-secret id.
    assertKeyString(key);
    await Companies.updateAsync(
      {_id: user.profile.companyId, 'publicCsafKeys.id': key},
      {$set: {'publicCsafKeys.$.published': published === true}});
  },

  'publicCsafKey.delete': async function (key) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, CSAF_KEY_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, NO_COMPANY);
    }
    assertKeyString(key);
    await Companies.updateAsync(user.profile.companyId, {$pull: {publicCsafKeys: {id: key}}});
  },

  'publicCsafKey.findByKey': async function (key) {
    assertKeyString(key);
    if (typeof key !== 'string' || !key) {
      return null;
    }
    const hashes = presentedKeyHashes(key);
    const company = await Companies.findOneAsync(
      {'publicCsafKeys.keyHash': {$in: hashes}},
      {fields: {publicCsafKeys: 1}});
    if (!company) {
      return null;
    }
    const csafKey = _.find(company.publicCsafKeys, function (item) {
      return hashes.indexOf(item.keyHash) > -1 && item.published !== false;
    });
    if (!csafKey) {
      return null;
    }
    return {companyId: company._id, csafKey: withoutSecret(csafKey)};
  },

  'publicCsafKey.saveRequest': async function (key, remoteAddress) {
    assertKeyString(key);
    await Companies.updateAsync(
      {'publicCsafKeys.keyHash': {$in: presentedKeyHashes(key)}},
      requestLogModifier('publicCsafKeys', remoteAddress || NOT_DETECTED));
  },

  'publicVexKey.getFile': async function (publicReleaseKeyKey, type) {
    assertKeyObject(publicReleaseKeyKey);
    assertStringField(publicReleaseKeyKey, 'releaseId');
    // Never run an unbound lookup: without a release there is no VEX to serve.
    if (!publicReleaseKeyKey.releaseId) {
      return {'error': 'VEX file not found'};
    }
    const approve = await Approves.findOneAsync(publicReleaseKeyKey.releaseId);
    if (!approve) {
      return {'error': 'VEX file not found'};
    }
    // See releaseHiddenFromCaller; `approve` is already loaded here.
    const user = await Meteor.userAsync();
    if (user && !isOwnCompany(user, approve.companyId)) {
      return {'error': 'VEX file not found'};
    }
    let report = type === 'changes' ?
      await Meteor.callAsync('getProjectVulnerabilityDifference', approve) :
      // Tenant-scoped, like the diff path - `approve` is read from the database
      // here, so its companyId is trustworthy.
      await ApprovalReports.findOneAsync(approvalReportSelector(approve._id, approve.companyId))
    let data = report && report.data ? report.data : report
    // vex.js is client-bundled and no longer computes product_ids; this feed runs
    // on the server, so it encodes in-process rather than over a round-trip.
    const productIds = data ? encodeIdMap((data.modules || []).map(module => module._id)) : {}
    // The SHARED floor, so this feed and the PURL-keyed one publish the same
    // document for the same release.
    let file = data ? await VEX.fromVulnerabilityReport(data, PUBLIC_VEX_CONFIDENCE,
      false, productIds): false
    if (!file) {
      return {'error': 'VEX file not found'};
    }
    let signature = await Signature.get(file)
    file.signatures = [signature]
    await Meteor.callAsync(STORE_SIGNATURE, {signature, type:'CSAF'})
    return file;
  },

  'publicVexKey.preview': async function (id) {
    return await Meteor.callAsync('publicVexKey.getFile', await previewReleaseKey(id));
  },

  'publicReleaseKey.find': async function (params) {
    // A DDP caller may only list its OWN company's release keys; a client-supplied
    // companyId is ignored (it would otherwise leak another tenant's keys, incl.
    // unpublished keys and per-request IP logs). Server/internal callers (no DDP
    // user) may target an explicit company.
    const user = await Meteor.userAsync();
    const companyId = user ? (user.profile && user.profile.companyId) : params.companyId;
    const companyItem = companyId
      && await Companies.findOneAsync(companyId, {fields: {publicReleaseKeys: 1}});
    if (!companyItem) {
      throw new Meteor.Error(404, RESOURCE_NF + JSON.stringify(params));
    }
    return _.filter(companyItem.publicReleaseKeys || [], function (item) {
      return item.releaseId === params.releaseId
    }).map(withoutSecret);
  },

  'getCountries': async function () {
    return countryList.getData()
  },

  // The algorithms a company may pick from are the ones it added itself. There
  // was a shared read-only catalog alongside them, but nothing ever seeded it
  // outside the hosted service, so it contributed no rows here.
  'getAlgorithms': async function () {
    return await companyAlgorithms();
  },

  // The Deny dialog also offers what the analysis detected in the company's
  // projects and a list of common algorithms, so a fresh installation can deny
  // DES or SHA-1 without adding them as private algorithms first.
  'getDenyAlgorithmChoices': async function () {
    const own = await companyAlgorithms();
    let detected = [];
    try {
      const user = await Meteor.userAsync();
      const overall = await Meteor.callAsync('getProjectBadAlgorithms', null, user.profile.companyId);
      detected = _.flatten(_.pluck(overall && overall.list || [], 'algorithms'));
    } catch (e) {
      console.log('[getDenyAlgorithmChoices] detected algorithms:', e.message);
    }
    return mergeAlgorithmChoices(own, detected.concat(COMMON_ALGORITHMS));
  },

  'findAlgorithms': async function (query) {
    const needle = String(query || '').toLowerCase();
    return (await companyAlgorithms()).filter((item)=>{
      return item.Algorithm.toLowerCase().indexOf(needle) > -1
    })
  }
});

// The caller's own algorithm list, in the {Algorithm, Strength} shape the crypto
// pickers render. Sorted by name so the dropdowns are stable.
async function companyAlgorithms() {
  const user = await Meteor.userAsync();
  const company = await Companies.findOneAsync(user.profile.companyId);
  return _.sortBy((company.privateAlgorithms || []).map((item)=>{
    return {
      Algorithm: item.key,
      Strength: +item.strength
    }
  }), 'Algorithm');
}

// Offered by the Deny dialog next to the company's own and detected algorithms.
const COMMON_ALGORITHMS = ['3DES', 'AES', 'Blowfish', 'DES', 'DH', 'DSA', 'ECDH', 'ECDSA', 'Ed25519',
  'HMAC', 'MD4', 'MD5', 'ML-DSA', 'ML-KEM', 'RC2', 'RC4', 'RSA', 'SHA-1', 'SHA-224', 'SHA-256',
  'SHA-384', 'SHA-512', 'SHA3-256', 'SHA3-512', 'X25519'];

// The company's own entries (with their strength) first, then the other names
// that are not already there, compared without case. Sorted by name.
export function mergeAlgorithmChoices(own, names) {
  const seen = new Set(own.map(item => item.Algorithm.toLowerCase()));
  const extra = [];
  names.forEach(name => {
    const key = typeof name === 'string' && name.trim();
    if (key && !seen.has(key.toLowerCase())) {
      seen.add(key.toLowerCase());
      extra.push({Algorithm: key});
    }
  });
  return _.sortBy(own.concat(extra), item => item.Algorithm.toLowerCase());
}

function getUserEmail(user) {
  return ((user.profile && user.profile.email)
  || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
}

// Validate that the resources a public key binds to belong to `companyId`.
// The public-key serving paths (publicBoMKey/publicNoticeKey/publicReleaseKey/
// publicVexKey getFile) resolve these references WITHOUT any company
// scoping, trusting that the stored key only ever points at the owner's own
// resources. That invariant must be enforced here at write time, otherwise a
// manager could bind a key to another tenant's project/module/notice/release and
// publish it to serve that tenant's BoM/Notice/SBOM/VEX through the public API.
async function assertOwnsKeyBindings(keyObj, companyId) {
  if (!keyObj || typeof keyObj !== 'object') {
    throw new Meteor.Error(400, 'Invalid key');
  }
  const checks = [
    ['project', Projects],
    ['module', Modules],
    ['noticeId', NoticeFiles],
    ['releaseId', Approves]
  ];
  for (const [field, Collection] of checks) {
    const value = keyObj[field];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (typeof value !== 'string'
      || !await Collection.findOneAsync({_id: value, companyId}, {fields: {_id: 1}})) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
  }
}

// REST auth (RestApi.getKeyMetaAndCompanyByAccountAndApiKey) looks up a
// company by the presented key's HMAC hash - no index existed for the
// previous plaintext query either (unindexed scan), so this is a strict
// improvement, not a regression.
Meteor.startup(function () {
  const RawCompanies = Utils.makeRawCollection(Companies);
  RawCompanies.createIndex('apiKeys.keyHash');
});
