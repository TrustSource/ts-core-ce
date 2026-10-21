import {Meteor} from 'meteor/meteor';
import policyFiles from '/imports/lib/collections/policyFiles';
import Policy from '/imports/lib/collections/policy';
import Utils from '/imports/server/ServerUtils';
import {asString} from '/imports/lib/security/sanitizeQuery';

const COLLECTION = 'policyFiles';

// `policy.file` is stored as-is from a client insert/update and the Policy collection has no
// attached schema, so it is not guaranteed to be a string. It ends up as a selector value below,
// where an object such as {$gt: ''} would stop being an id match and start being an operator
// expression - selecting every policy file of every tenant. Everything that reads it goes through
// policyFileId() first; a non-string reference is treated as "this policy has no file". (The
// write gates in server/collections/policy.js reject one at the source.)
function policyFileId(value) {
  const fileId = asString(value);
  return fileId || null;
}

// A policy file is visible to a company because one of that company's policies references it.
// Resolving that list once - Policy.find().fetch() -> find({_id: {$in: ids}}) - made this
// publication static: the id set was frozen when the subscription started, so a policy uploaded
// afterwards never had its file pushed and the list rendered "No file" (and the Knowledge page
// dropped its download link entirely) until a full page reload. The subscription starts once at
// app boot (imports/startup/client/index.js), so for a fresh company the frozen set was empty
// and no policy file ever arrived.
//
// Keep the join live instead: observe the company's policies and add/remove the referenced file
// documents as that set changes. The authorization predicate is unchanged and still mirrors
// policyFiles.protected() - a file is published iff a policy of the caller's company points at it.
Meteor.publish('policyFiles', async function () {
  const self = this;
  if (!self.userId) { return self.ready(); }
  const companyId = await Utils.getCompanyIdForUserAsync(self.userId);
  if (!companyId) { return self.ready(); }

  const fileIdByPolicy = new Map();  // policyId -> file id it currently references
  const refCount = new Map();        // file id -> number of policies referencing it
  const fileHandles = new Map();     // file id -> observe handle
  const addedFiles = new Set();      // file ids actually pushed to this client
  let stopped = false;

  // Observe callbacks are synchronous but retain/release are not, so run them through one
  // chain: a policy switching files must release the old id after retaining the new one.
  let queue = Promise.resolve();
  function enqueue(task) {
    queue = queue.then(task).catch(function (error) {
      console.error('=> policyFiles publication:', error && error.message || error);
    });
  }

  async function retainFile(fileId) {
    if (typeof fileId !== 'string' || !fileId || stopped) return;
    const next = (refCount.get(fileId) || 0) + 1;
    refCount.set(fileId, next);
    if (next > 1) return;  // already observed for another policy
    // A live query, so the file document is picked up even if it lands after the policy.
    const handle = await policyFiles.collection.find({_id: fileId}).observeChangesAsync({
      added: function (id, fields) {
        addedFiles.add(id);
        self.added(COLLECTION, id, fields);
      },
      changed: function (id, fields) {
        self.changed(COLLECTION, id, fields);
      },
      removed: function (id) {
        addedFiles.delete(id);
        self.removed(COLLECTION, id);
      }
    });
    if (stopped) {
      handle.stop();
      return;
    }
    fileHandles.set(fileId, handle);
  }

  function releaseFile(fileId) {
    if (typeof fileId !== 'string' || !fileId) return;
    const next = (refCount.get(fileId) || 0) - 1;
    if (next > 0) {
      refCount.set(fileId, next);
      return;
    }
    refCount.delete(fileId);
    const handle = fileHandles.get(fileId);
    if (handle) {
      handle.stop();
      fileHandles.delete(fileId);
    }
    // Only retract what was actually sent, otherwise DDP gets a removed for an unknown doc.
    if (addedFiles.delete(fileId)) {
      self.removed(COLLECTION, fileId);
    }
  }

  const policyHandle = await Policy.find({companyId}, {fields: {file: 1}}).observeChangesAsync({
    added: function (policyId, fields) {
      const fileId = policyFileId(fields.file);
      fileIdByPolicy.set(policyId, fileId);
      if (!fileId) return;
      enqueue(function () { return retainFile(fileId); });
    },
    changed: function (policyId, fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, 'file')) return;
      const previous = fileIdByPolicy.get(policyId);
      const fileId = policyFileId(fields.file);
      if (previous === fileId) return;
      fileIdByPolicy.set(policyId, fileId);
      enqueue(async function () {
        await retainFile(fileId);
        releaseFile(previous);
      });
    },
    removed: function (policyId) {
      const previous = fileIdByPolicy.get(policyId);
      fileIdByPolicy.delete(policyId);
      enqueue(function () { releaseFile(previous); });
    }
  });

  self.onStop(function () {
    stopped = true;
    policyHandle.stop();
    fileHandles.forEach(function (handle) { handle.stop(); });
    fileHandles.clear();
  });

  // Signal ready only once the files for the policies that already exist have been sent.
  await queue;
  self.ready();
});
