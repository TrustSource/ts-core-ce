// ---------------------------------------------------------------------------
// The single tenant-ownership lookup behind the CSAF product_id methods and the
// CSAF removal path. Kept in one place so encode, decode and remove.js cannot
// drift on what "the caller owns this id" means.
//
// A CSAF document's product_id may encode either a module `_id` (the usual case)
// or a product `_id` (the wizard's Products tab). Both collections carry
// `companyId`, so the check is the same shape for both.
//
// Meteor 3: fetch() is client-only on the server side of the API - fetchAsync().
// ---------------------------------------------------------------------------
import Modules from '/imports/lib/collections/modules';
import Products from '/imports/lib/collections/products';

// The id list is caller-shaped: remove.js hands over every decoded product_id of
// one CSAF document, and neither csaf/create.js nor CSAFSchema caps that
// document's size, so a single `$in` here would be bounded only by what was
// uploaded. Chunked into indexed queries of a fixed width instead - the tenant
// scope is part of every chunk's selector, so splitting cannot widen it.
const QUERY_CHUNK = 1000;

async function ownedIn(collection, ids, companyId) {
  const owned = [];
  for (let start = 0; start < ids.length; start += QUERY_CHUNK) {
    const docs = await collection
      .find({_id: {$in: ids.slice(start, start + QUERY_CHUNK)}, companyId}, {fields: {_id: 1}})
      .fetchAsync();
    docs.forEach((doc) => owned.push(doc._id));
  }
  return owned;
}

function isEmptyRequest(ids, companyId) {
  return !companyId || !Array.isArray(ids) || ids.length === 0;
}

/**
 * Which of `ids` are modules of `companyId`? Used where the decoded id drives a
 * write into Modules, so a product id must NOT satisfy it.
 * @returns {Promise<Set<string>>}
 */
export async function filterOwnedModuleIds(ids, companyId) {
  if (isEmptyRequest(ids, companyId)) {
    return new Set();
  }
  return new Set(await ownedIn(Modules, ids, companyId));
}

/**
 * Which of `ids` are modules OR products of `companyId`? Two indexed `$in`
 * queries at most - the products query only runs for the ids the modules query
 * did not already account for.
 * @returns {Promise<Set<string>>}
 */
export async function filterOwnedIds(ids, companyId) {
  if (isEmptyRequest(ids, companyId)) {
    return new Set();
  }
  const owned = new Set(await ownedIn(Modules, ids, companyId));
  const remaining = ids.filter((id) => !owned.has(id));
  if (remaining.length) {
    (await ownedIn(Products, remaining, companyId)).forEach((id) => owned.add(id));
  }
  return owned;
}
