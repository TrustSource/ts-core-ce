import {Mongo} from 'meteor/mongo';

// Some collections (cotsComponents, infrastructureComponents) store real Mongo
// ObjectIds rather than Meteor's string ids, and that breaks routing twice over:
//
//  1. Mongo.ObjectID.toString() returns 'ObjectID("<hex>")', so an id handed
//     straight to Router.go lands in the address bar as
//     /infrastructure_components/ObjectID(%226a19...%22).
//  2. Even with a clean hex URL, findOne('<hex>') builds {_id: '<hex>'} and
//     never matches a doc whose _id is an ObjectId - the page then waits on a
//     subscription that resolves to nothing.
//
// Shared (not under a client/ dir) because the publications need it too.

const HEX_24 = /^[0-9a-f]{24}$/i;
const WRAPPED = /^ObjectID\(\s*["']?([0-9a-f]{24})["']?\s*\)$/i;

/** 'ObjectID("<hex>")' -> '<hex>'; anything else is returned unchanged. */
export function unwrapId(raw) {
  if (!raw) {
    return raw;
  }
  const match = String(raw).match(WRAPPED);
  return match ? match[1] : String(raw);
}

/** True for the stringified-ObjectID form that ends up in old links. */
export function isWrappedId(raw) {
  return !!raw && WRAPPED.test(String(raw));
}

/**
 * Selector matching the doc whichever way its _id is stored. A 24-hex param
 * could legitimately be either an ObjectId or a plain string id, and both forms
 * exist across environments, so match on both rather than guessing.
 */
export function idSelector(raw) {
  const id = unwrapId(raw);
  if (HEX_24.test(id)) {
    return {_id: {$in: [new Mongo.ObjectID(id), id]}};
  }
  return {_id: id};
}

/** The hex form of an id, safe to interpolate into a route path. */
export function idParam(id) {
  if (id && typeof id === 'object' && id._str) {
    return id._str;
  }
  return unwrapId(id);
}
