import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Webhooks from '/imports/lib/collections/webhooks';
import Utils from '/imports/server/ServerUtils';
import {assertSafePublicUrl} from '/imports/lib/security/ssrfGuard';
import {WEBHOOK_ADMIN_ROLES, projectBelongsToCompany} from '/imports/lib/company/webhookAccess';

// A webhook row IS a credential. `url` is a bearer token on a Slack or Teams
// incoming webhook, and `headers[].value` is where an API key lives - the webhook
// DEBUG log redacts exactly these two fields before writing a line. Both
// publications used to hand the whole document to any authenticated member of
// the company, with no role check at all, while the roles below are the ones
// that may CREATE such a row. Reading a receiver's credential is at least as
// privileged as writing one.
//
// So the gate is the subscription itself: a member without one of these roles
// gets nothing, and both list pages render their empty state. Anything narrower
// (blanking the two columns) would still tell them a receiver exists and how it
// is triggered. WEBHOOK_ADMIN_ROLES is that list, declared once in
// webhookAccess.js and shared with the create interactor and the allow rule.

// Exactly the fields the two list pages render, plus `projectId`, which the
// project settings page filters its client-side cursor on. `userId`/`userName`
// are stored but shown nowhere, so they are not sent.
// The url and header values are credentials and are stored encrypted; the pages
// show the masked url and the header names only.
const WEBHOOK_LIST_FIELDS = {
  created: 1, name: 1, type: 1, triggers: 1, method: 1, urlDisplay: 1, 'headers.key': 1, projectId: 1
};

// The subscriber's company, or null when they may not read receivers at all.
async function webhookReaderCompanyId(userId) {
  if (!userId) {
    return null;
  }
  const user = await Meteor.users.findOneAsync(userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return null;
  }
  return await Roles.userIsInRole(user._id, WEBHOOK_ADMIN_ROLES, companyId) ? companyId : null;
}

Meteor.publish('webhooks', async function () {
  const companyId = await webhookReaderCompanyId(this.userId);
  if (companyId) {
    return Webhooks.find({companyId, projectId: {$exists: false}}, {fields: WEBHOOK_LIST_FIELDS})
  }
  this.ready();
});

Meteor.publish('webhooksByProjectId', async function (projectId) {
  // `projectId` is whatever the client sent. Without the type check
  // `{$ne: null}` in this position widens the selector to every project webhook
  // in the company - the standing repo rule for a field used in a selector.
  if (typeof projectId !== 'string' || !projectId) {
    return this.ready();
  }
  const companyId = await webhookReaderCompanyId(this.userId);
  if (companyId) {
    return Webhooks.find({companyId, projectId}, {fields: WEBHOOK_LIST_FIELDS})
  }
  this.ready();
});

// Insert only. There is no update or remove arm: rows are never edited in place, and
// Webhook.Remove is the remove path.
Webhooks.allow({
  insert: async function (userId, doc) {
    // Role and tenant FIRST - an unauthorized caller must not learn anything
    // about the egress policy from the shape of the refusal.
    if (!await checkManager(userId, doc)) {
      return false
    }
    // The same project-scope check the interactor performs. This allow rule IS
    // the path that bypasses the interactor, so a check that lives only there
    // is a check this path does not have - which is exactly how the SSRF gate
    // below came to be duplicated onto the insert.
    if (!await projectBelongsToCompany(doc && doc.projectId, doc && doc.companyId)) {
      return false
    }
    return isSafeTarget(doc)
  }
});

// The SSRF input gate, on the INSERT itself.
//
// It already lived in imports/lib/interactors/webhooks/create.js, but this allow
// rule lets a manager insert a document straight from the browser without going
// through that interactor - so the gate never ran, for ANY trigger. Closing it
// here covers release, approval, task and both vulnerability triggers at once.
//
// Returns false rather than throwing: an allow rule cannot carry a status code,
// and the interactor's generic `Meteor.Error(400, 'Invalid integration URL')` is
// deliberately detail-free because ssrfGuard's own message would otherwise be an
// SSRF oracle. Same discipline here - the reason is logged server-side, and the
// url NEVER is, because a webhook url is itself a bearer token.
function isSafeTarget(doc) {
  const url = doc && doc.url;
  if (!url) {
    // A slack/teams row may legitimately carry no url yet; there is nothing to
    // egress to, so this is not an egress decision.
    return true
  }
  try {
    assertSafePublicUrl(url)
    return true
  } catch (error) {
    console.info('=> webhooks: refused an insert for company', doc && doc.companyId,
      'named', (doc && doc.name) || '<unnamed>', '-', (error && error.message) || 'invalid target')
    return false
  }
}

async function checkManager(userId, doc) {
  const user = userId && await Meteor.users.findOneAsync(userId);
  const companyId = user && user.profile && user.profile.companyId;
  return !!(companyId && doc && await Roles.userIsInRole(user._id, WEBHOOK_ADMIN_ROLES,
    companyId) && (companyId === doc.companyId))
}

/**
 * Create global raw Collection and ensure indexes
 */

export let RawWebhooks;

Meteor.startup(function () {
  RawWebhooks = Utils.makeRawCollection(Webhooks);
  RawWebhooks.createIndex('companyId');
  RawWebhooks.createIndex('projectId');
  RawWebhooks.createIndex('created');
});
