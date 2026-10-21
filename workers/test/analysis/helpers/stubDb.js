/**
 * In-memory MongoDB stub for testing.
 * Implements the subset of the MongoDB driver API used by Utils.dbFind/dbFindOne and the analysis pipeline.
 */

export function createStubDb(dataMap = {}) {
  const collections = {};

  for (const [name, docs] of Object.entries(dataMap)) {
    collections[name] = [...docs];
  }

  function getCollection(name) {
    if (!collections[name]) {
      collections[name] = [];
    }
    return collections[name];
  }

  // Every value a dot path reaches, stepping into arrays on the way, the way Mongo
  // matches 'versions.version' against a document whose `versions` is an array.
  function valuesAt(doc, path) {
    let current = [doc];
    for (const part of path.split('.')) {
      const nextValues = [];
      for (const value of current) {
        if (value === null || value === undefined) {
          continue;
        }
        const child = value[part];
        if (Array.isArray(child)) {
          nextValues.push(...child);
        } else {
          nextValues.push(child);
        }
      }
      current = nextValues;
    }
    return current;
  }

  function matchFilter(doc, filter) {
    if (!filter || Object.keys(filter).length === 0) return true;
    for (const [key, value] of Object.entries(filter)) {
      if (key === '$and') {
        return value.every(sub => matchFilter(doc, sub));
      }
      if (key === '$or') {
        return value.some(sub => matchFilter(doc, sub));
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if ('$in' in value) {
          if (!valuesAt(doc, key).some(found => value.$in.includes(found))) return false;
          continue;
        }
        if ('$not' in value) {
          if (matchFilter(doc, { [key]: value.$not })) return false;
          continue;
        }
        if ('$exists' in value) {
          const exists = doc[key] !== undefined;
          if (value.$exists !== exists) return false;
          continue;
        }
        if ('$size' in value) {
          if (!Array.isArray(doc[key]) || doc[key].length !== value.$size) return false;
          continue;
        }
        if ('$gte' in value || '$lt' in value) {
          const v = doc[key];
          if ('$gte' in value && v < value.$gte) return false;
          if ('$lt' in value && v >= value.$lt) return false;
          continue;
        }
      }
      // Dot-notation support for simple paths
      const parts = key.split('.');
      let val = doc;
      for (const p of parts) {
        val = val && val[p];
      }
      if (val !== value) return false;
    }
    return true;
  }

  // Every read returns a FRESH deep copy, the way the real driver hands back a newly
  // deserialized BSON document per query. Do not revert this to a shared reference.
  //
  // The pipeline reads the same component twice - Analysis.loadComponent, then
  // getModuleComponents - and loadComponent MUTATES what it got, pushing the
  // assigned/scan-declared licenses into comp.declaredLicenses as a bridge for
  // legalAnalysis. Sharing one object would leak that mutation into the second read,
  // giving Utils.rebuildModuleObject a declaredLicenses fallback production never has.
  // The legal-check payload would then assert green with mergeWorkingSetLicenses
  // deleted outright - verified.
  function hydrate(doc) {
    if (doc === null || typeof doc !== 'object') return doc;
    return structuredClone(doc);
  }

  return {
    collection(name) {
      const docs = getCollection(name);
      return {
        find(filter, projection) {
          const matched = docs.filter(d => matchFilter(d, filter));
          let _limit = 0;
          let _sort = {};
          return {
            limit(n) { _limit = n; return this; },
            sort(s) { _sort = s; return this; },
            async toArray() {
              let result = [...matched];
              if (_sort && Object.keys(_sort).length) {
                const [sortKey, sortDir] = Object.entries(_sort)[0];
                result.sort((a, b) => ((a[sortKey] > b[sortKey] ? 1 : -1) * sortDir));
              }
              if (_limit > 0) result = result.slice(0, _limit);
              return result.map(hydrate);
            }
          };
        },
        async findOne(filter) {
          const found = docs.find(d => matchFilter(d, filter));
          return found ? hydrate(found) : null;
        },
        async insertOne(doc) {
          docs.push(doc);
          return { insertedId: doc._id || 'stub-id' };
        },
        async updateOne() {
          return { modifiedCount: 1 };
        },
        async updateMany() {
          return { modifiedCount: 0 };
        },
        async bulkWrite(operations) {
          let upsertedCount = 0;
          for (const operation of operations) {
            const replace = operation && operation.replaceOne;
            if (!replace) {
              throw new Error('stubDb.bulkWrite supports replaceOne only');
            }
            const index = docs.findIndex(d => matchFilter(d, replace.filter));
            if (index > -1) {
              docs[index] = structuredClone(replace.replacement);
            } else if (replace.upsert) {
              docs.push(structuredClone(replace.replacement));
              upsertedCount++;
            }
          }
          return { upsertedCount };
        }
      };
    },
    _collections: collections
  };
}
