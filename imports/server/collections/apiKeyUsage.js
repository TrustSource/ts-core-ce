import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import ApiKeyUsage from '/imports/lib/collections/apiKeyUsage';
import Utils from '/imports/server/ServerUtils';

// How long daily counts are kept, and how many days the API keys page shows.
const RETENTION_DAYS = 90;
export const USAGE_WINDOW_DAYS = 30;

ApiKeyUsage.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Count one REST request for an API key. Never throws: a failed count must not
 * fail the request it counts.
 *
 * @param {String} companyId
 * @param {String} keyId the key's non-secret id
 * @param {Date} [now]
 */
export async function recordApiKeyUsage(companyId, keyId, now = new Date()) {
  if (typeof companyId !== 'string' || typeof keyId !== 'string' || !keyId) {
    return;
  }
  const day = utcDay(now);
  try {
    await ApiKeyUsage.rawCollection().updateOne(
      {_id: `${keyId}:${day}`},
      {$inc: {count: 1}, $setOnInsert: {companyId, keyId, day, date: new Date(`${day}T00:00:00.000Z`)}},
      {upsert: true});
  } catch (error) {
    console.log('API key usage could not be recorded:', error && error.message);
  }
}

/**
 * Requests per key over the last `days` days of a company.
 *
 * @returns {Promise<Object>} {<keyId>: {total, days: {<YYYY-MM-DD>: count}}}
 */
export async function apiKeyUsageForCompany(companyId, days = USAGE_WINDOW_DAYS, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const rows = await ApiKeyUsage.find({companyId, date: {$gte: since}},
    {fields: {keyId: 1, day: 1, count: 1}}).fetchAsync();
  const usage = {};
  rows.forEach(function (row) {
    const entry = usage[row.keyId] || (usage[row.keyId] = {total: 0, days: {}});
    entry.total += row.count || 0;
    entry.days[row.day] = row.count || 0;
  });
  return usage;
}

Meteor.methods({
  // API key usage for the company's API keys page (Account admin only).
  'apiKey.usage': async function () {
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId || !await Roles.userIsInRoleAsync(user._id, ['account_admin'], companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return await apiKeyUsageForCompany(companyId);
  }
});

Meteor.startup(async function () {
  const raw = Utils.makeRawCollection(ApiKeyUsage);
  try {
    await raw.createIndex({companyId: 1, date: 1});
    // Daily counts older than the retention are removed by MongoDB.
    await raw.createIndex({date: 1}, {expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60});
  } catch (error) {
    console.log('apiKeyUsage indexes could not be created:', error && error.message);
  }
});
