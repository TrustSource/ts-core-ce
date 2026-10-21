import {Meteor} from 'meteor/meteor';
import crypto from 'crypto';
import Webhooks from '/imports/lib/collections/webhooks';
import {encrypt, decryptV2Only, VERSION_PREFIX} from '/imports/lib/crypto';

// A webhook's url and header values are its receiver's credentials (a Slack or
// Teams incoming webhook url is a bearer token, a header often an Authorization
// value). They are stored encrypted with TS_ENCRYPTION_KEY and decrypted only right
// before a delivery (ts-webhook.js). The list pages get `urlDisplay` and the header
// names, never the values.
//
// `secret` is the webhook's signing secret, stored encrypted the same way: every
// delivery carries X-TrustSource-Signature, an HMAC-SHA256 of
// `<X-TrustSource-Timestamp>.<body>` with it (workers/webhook/services/Webhook.js).

const isSealed = (value) => typeof value === 'string' && value.startsWith(VERSION_PREFIX);

// scheme://host/… - enough to recognise the receiver; the path and query, where
// the tokens live, are left out.
export function maskWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/…`;
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (error) {
    return '';
  }
}

function sealValue(value) {
  if (typeof value !== 'string' || !value || isSealed(value)) {
    return value;
  }
  const sealed = encrypt(value);
  if (!isSealed(sealed)) {
    throw new Error('webhook secret could not be encrypted');
  }
  return sealed;
}

export function newSigningSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * The stored form of a webhook's url and headers.
 *
 * @param {{url?: String, headers?: Array<{key, value}>}} doc plaintext values
 * @returns {Object} fields to store: url (encrypted), urlDisplay, headers (values encrypted)
 */
export function sealWebhookFields(doc) {
  const fields = {};
  if (typeof doc.url === 'string' && doc.url) {
    if (!isSealed(doc.url)) {
      fields.urlDisplay = maskWebhookUrl(doc.url);
    }
    fields.url = sealValue(doc.url);
  }
  if (Array.isArray(doc.headers)) {
    fields.headers = doc.headers.map(function (header) {
      return Object.assign({}, header, {value: sealValue(header && header.value)});
    });
  }
  // Every webhook gets a signing secret; one stored before signing existed gets
  // one when it is sealed.
  fields.secret = sealValue(doc.secret || newSigningSecret());
  return fields;
}

/**
 * A copy of a stored webhook row with its url and header values decrypted, for
 * delivery. Values stored before encryption are returned as they are.
 */
export function openWebhookRow(row) {
  if (!row) {
    return row;
  }
  const opened = Object.assign({}, row);
  if (typeof row.url === 'string') {
    opened.url = decryptV2Only(row.url);
  }
  if (Array.isArray(row.headers)) {
    opened.headers = row.headers.map(function (header) {
      return Object.assign({}, header, {value: decryptV2Only(header && header.value)});
    });
  }
  delete opened.secret;
  if (typeof row.secret === 'string' && row.secret) {
    opened.signingSecret = decryptV2Only(row.secret);
  }
  return opened;
}

function needsSealing(row) {
  return !isSealed(row.secret) ||
    (typeof row.url === 'string' && row.url && !isSealed(row.url)) ||
    (Array.isArray(row.headers) && row.headers.some((h) => h && typeof h.value === 'string' && h.value && !isSealed(h.value)));
}

async function sealStoredRow(row) {
  try {
    await Webhooks.updateAsync({_id: row._id}, {$set: sealWebhookFields(row)}, {bypassCollection2: true});
  } catch (error) {
    console.log('=> webhooks: row', row._id, 'could not be encrypted:', error && error.message);
  }
}

// Rows stored in plaintext - before encryption, or inserted by the client allow
// rule - are encrypted on startup and as soon as they appear.
Meteor.startup(async function () {
  if (!process.env.TS_ENCRYPTION_KEY && !process.env.TS_ENCRYPTION_KEY_LEGACY) {
    return;
  }
  const rows = await Webhooks.find({}, {fields: {url: 1, headers: 1, secret: 1}, transform: null}).fetchAsync();
  for (const row of rows.filter(needsSealing)) {
    await sealStoredRow(row);
  }
  await Webhooks.find({$or: [{url: {$exists: true, $not: /^v2:/}}, {secret: {$exists: false}}]},
    {fields: {url: 1, headers: 1, secret: 1}, transform: null})
    .observeAsync({added: (row) => { sealStoredRow(row); }});
});

/**
 * The signing secret of a webhook, for its receiver to verify deliveries.
 */
export function revealSigningSecret(row) {
  const secret = row && typeof row.secret === 'string' ? decryptV2Only(row.secret) : null;
  if (typeof secret !== 'string' || !secret || isSealed(secret)) {
    throw new Meteor.Error(500, 'The signing secret could not be read');
  }
  return secret;
}
