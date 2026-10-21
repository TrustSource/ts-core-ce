import {Mongo} from 'meteor/mongo';
import _ from 'underscore';
import Utils from '/imports/server/ServerUtils';
import {Config} from '/imports/server/config';

const ServerSideCollection = {}

// Resolve the total `items` count for pagination, using the cheapest path
// available given the fetch result we already have.
//
//   * Partial page (list.length < size) and we're not at the limit cap:
//       items is exact: skip + list.length. No extra query.
//   * Empty selector: ask Mongo for the metadata count
//     (estimatedDocumentCount) instead of scanning. Capped if `limit` is set.
//   * Otherwise: fall back to countAsync, capped by `limit` like before.
async function computeItems(collection, selector, skip, size, limit, listLen) {
  const couldExceedLimit = !!limit && (skip + size) >= limit;
  if (listLen < size && !couldExceedLimit) {
    return skip + listLen;
  }
  const isEmptySelector = !selector || Object.keys(selector).length === 0;
  if (isEmptySelector) {
    const estimated = await collection.rawCollection().estimatedDocumentCount();
    return limit ? Math.min(estimated, limit) : estimated;
  }
  return await collection.find(selector, {fields: {_id: 1}, limit}).countAsync();
}

ServerSideCollection.count = async function (collection, {selector}){
  const startTime = new Date();
  if (collection instanceof Mongo.Collection) {
    const collectionName = Utils.capitalizeFirstLetter(collection._name)
    const items = await collection.find(selector, {fields: {_id: 1}}).countAsync()
    if(Config.DEBUG_MODE_ENABLED){
      console.info('=> %s.Count: ', collectionName, items)
      console.info('=> %s.Count: took %s millis', collectionName, new Date() - startTime);
    }
    return items
  }
  return []
}

 
ServerSideCollection.find = async function (collection, {selector, sort, page, limit, size, fields}){
  const startTime = new Date();
  if (collection instanceof Mongo.Collection) {
    const collectionName = Utils.capitalizeFirstLetter(collection._name)
    if(!size){
      size = 10
    }
    if(!page){
      page = 0
    }
    if(!fields){
      fields = {}
    }
    if(selector && selector.$and){
      selector.$and = (selector.$and && selector.$and.length) ? _.map(selector.$and,(filter)=>{
        if(filter.date){
          filter.date.$gte = new Date(filter.date.$gte)
          filter.date.$lte = new Date(filter.date.$lte)
        }
        if(filter.$and){
          filter.$and = (filter.$and && filter.$and.length) ? _.map(filter.$and,(subFilter)=>{
            if(subFilter.date){
              subFilter.date.$gte = new Date(subFilter.date.$gte)
              subFilter.date.$lte = new Date(subFilter.date.$lte)
            }
            return subFilter
          }) : filter.$and
        }
        return filter
      }) : selector.$and
    }
    const skip = Math.floor(page*size)
    const list = await collection.find(selector, {sort, skip, limit: size, fields}).fetchAsync()
    const items = await computeItems(collection, selector, skip, size, limit, list.length)
    const pages = Math.ceil(items/size)
    const meta = {
      items,
      pages,
      size,
      page
    }

    if(Config.DEBUG_MODE_ENABLED){
      console.info('=> %s.Find: ', collectionName, meta)
      console.info('=> %s.Find: took %s millis', collectionName, new Date() - startTime);
    }
    return {
      list,
      meta
    }
  }
  return []
}

ServerSideCollection.findOne = async function (collection, {selector, sort, skip, fields}){
  const startTime = new Date();
  if (collection instanceof Mongo.Collection) {
    const collectionName = Utils.capitalizeFirstLetter(collection._name)
    let entry = await collection.findOneAsync(selector, {sort, skip, fields})
    if(Config.DEBUG_MODE_ENABLED){
      console.info('=> %s.FindOne: took %s millis', collectionName, new Date() - startTime);
    }
    return entry
  }
  return []
}

ServerSideCollection.countAsync = async function (collection, {selector}){
  const startTime = new Date();
  if (collection instanceof Mongo.Collection) {
    const collectionName = Utils.capitalizeFirstLetter(collection._name)
    const items = await collection.find(selector, {fields: {_id: 1}}).countAsync()
    if(Config.DEBUG_MODE_ENABLED){
      console.info('=> %s.CountAsync: ', collectionName, items)
      console.info('=> %s.CountAsync: took %s millis', collectionName, new Date() - startTime);
    }
    return items
  }
  return []
}

 
ServerSideCollection.findAsync = async function (collection, {selector, sort, page, limit, size, fields}){
  const startTime = new Date();
  if (collection instanceof Mongo.Collection) {
    const collectionName = Utils.capitalizeFirstLetter(collection._name)
    if(!size){
      size = 10
    }
    if(!page){
      page = 0
    }
    if(!fields){
      fields = {}
    }
    if(selector && selector.$and){
      selector.$and = (selector.$and && selector.$and.length) ? _.map(selector.$and,(filter)=>{
        if(filter.date){
          filter.date.$gte = new Date(filter.date.$gte)
          filter.date.$lte = new Date(filter.date.$lte)
        }
        if(filter.$and){
          filter.$and = (filter.$and && filter.$and.length) ? _.map(filter.$and,(subFilter)=>{
            if(subFilter.date){
              subFilter.date.$gte = new Date(subFilter.date.$gte)
              subFilter.date.$lte = new Date(subFilter.date.$lte)
            }
            return subFilter
          }) : filter.$and
        }
        return filter
      }) : selector.$and
    }
    const skip = Math.floor(page*size)
    const list = await collection.find(selector, {sort, skip, limit: size, fields}).fetchAsync()
    const items = await computeItems(collection, selector, skip, size, limit, list.length)
    const pages = Math.ceil(items/size)
    const meta = {
      items,
      pages,
      size,
      page
    }

    if(Config.DEBUG_MODE_ENABLED){
      console.info('=> %s.FindAsync: ', collectionName, meta)
      console.info('=> %s.FindAsync: took %s millis', collectionName, new Date() - startTime);
    }
    return {
      list,
      meta
    }
  }
  return []
}

ServerSideCollection.findOneAsync = async function (collection, {selector, sort, skip, fields}){
  const startTime = new Date();
  if (collection instanceof Mongo.Collection) {
    const collectionName = Utils.capitalizeFirstLetter(collection._name)
    let entry = await collection.findOneAsync(selector, {sort, skip, fields})
    if(Config.DEBUG_MODE_ENABLED){
      console.info('=> %s.FindOneAsync: took %s millis', collectionName, new Date() - startTime);
    }
    return entry
  }
  return []
}

export default ServerSideCollection;
