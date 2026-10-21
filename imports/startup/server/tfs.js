/* global Promise:false */
import {Meteor} from 'meteor/meteor';
import tfs, {collectionUrl} from '/imports/lib/tfs';
import {assertSafeEgressUrl} from '/imports/lib/security/ssrfGuard';
import {ProjectsGetTfsCredentials} from '/imports/lib/interactors/projects';
import {requireProjectAccess} from '/imports/server/security/methodGuards';
import {tsWebhook} from '/imports/startup/server/ts-webhook';

// Wraps a callback-style TFS SDK invocation in a Promise while preserving the
// Meteor method `this` so the inner function can run authorization checks.
//
// Every wrapped function is `async`, so it never throws synchronously - it returns a
// promise, and that promise has to be observed here. Left unobserved it was an unhandled
// rejection, which ends the whole server process rather than the method call: a failed
// authorization check or a project with no TFS account took the app down, and Meteor's
// re-send of the outstanding call on reconnect took the next one down too.
const future = function (callback) {
  return function (...args) {
    const invocation = this;
    return new Promise((resolve, reject) => {
      const settle = function (error, response) {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      };
      const fail = function (error) {
        // An authorization failure already carries its own status (404/403); re-wrapping
        // it as a 500 would hide that from the caller.
        if (error instanceof Meteor.Error) {
          reject(error);
          return;
        }
        const raw = (error && error.message) || String(error);
        const message = raw.match(/Invalid Resource/) ?
          'The request has not been applied because it lacks valid ' +
          'authentication credentials for the target resource. Please check you TFS authorization.' : raw;
        reject(new Meteor.Error(500, message));
      };
      try {
        Promise.resolve(callback.call(invocation, ...args, settle)).catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }
};

// The TFS account URL is checked at save time without DNS; resolve it here too, so a
// stored host that now points into the internal network is never called.
async function tfsClient({account, token}) {
  try {
    await assertSafeEgressUrl(collectionUrl(account));
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_e) {
    throw new Meteor.Error(400, 'TFS URL is not allowed');
  }
  return tfs({account, token});
}

Meteor.methods({
  'tfs.workItems.getAll': future(async function (projectId, options, callback) {
    await requireProjectAccess(this, projectId);
    const {account, token, project} = await ProjectsGetTfsCredentials(projectId);
    return (await tfsClient({account, token})).getWorkItems().getAll(project, options || {}, callback);
  }),
  'tfs.workItems.get': future(async function (projectId, id, callback) {
    await requireProjectAccess(this, projectId);
    const {account, token} = await ProjectsGetTfsCredentials(projectId);
    return (await tfsClient({account, token})).getWorkItems().get(id, callback);
  }),
  'tfs.workItems.create': future(async function (projectId, type, data, callback) {
    await requireProjectAccess(this, projectId);
    const {account, token, project, companyId} = await ProjectsGetTfsCredentials(projectId);
    try {
      await tsWebhook({
        companyId: companyId,
        projectId: projectId,
        trigger: 'task',
        data: {
          details: data
        }
      });
    }catch (e) {console.log(e)}
    return (await tfsClient({account, token})).getWorkItems().create(project, type, data, callback);
  }),
  'tfs.workItems.update': future(async function (projectId, id, data, callback) {
    await requireProjectAccess(this, projectId);
    const {account, token} = await ProjectsGetTfsCredentials(projectId);
    return (await tfsClient({account, token})).getWorkItems().update(id, data, callback);
  }),
  'tfs.workItems.delete': future(async function (projectId, id, callback) {
    await requireProjectAccess(this, projectId);
    const {account, token} = await ProjectsGetTfsCredentials(projectId);
    return (await tfsClient({account, token})).getWorkItems().delete(id, callback);
  }),
  'tfs.workItems.getTypes': future(async function (projectId, callback) {
    await requireProjectAccess(this, projectId);
    const {account, token, project} = await ProjectsGetTfsCredentials(projectId);
    return (await tfsClient({account, token})).getWorkItems().getTypes(project, callback);
  }),
  'tfs.workItems.getTypeStates': future(async function (projectId, type, callback) {
    await requireProjectAccess(this, projectId);
    const {account, token, project} = await ProjectsGetTfsCredentials(projectId);
    return (await tfsClient({account, token})).getWorkItems().getTypeStates(project, type, callback);
  })
});
