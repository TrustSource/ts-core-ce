import {Meteor} from 'meteor/meteor';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';

// Authorization helpers for DDP-callable Meteor methods that proxy to
// service-account-backed integrations (GitHub, Jira, etc.).
//
// Every helper bypasses its check when invocation.connection is null - that
// indicates a server-to-server call from a collection hook, interactor, or
// other trusted code path. Only calls originating from a DDP client (and
// therefore controllable by an attacker) are validated.

function isServerInternal(invocation) {
  return !invocation || !invocation.connection;
}

async function getCallerCompanyId(userId) {
  const user = await Meteor.users.findOneAsync(userId, {fields: {'profile.companyId': 1}});
  return user && user.profile && user.profile.companyId;
}

// Reject any DDP-originated call. Use on methods that should only ever be
// invoked from server code (collection hooks, interactors, internal scripts).
export function denyDDP(invocation) {
  if (!isServerInternal(invocation)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
}

// Require an authenticated caller. No tenant or role check.
export function requireLogin(invocation) {
  if (isServerInternal(invocation)) return;
  if (!invocation.userId) {
    throw new Meteor.Error(401, 'Login required');
  }
}

// Require the caller to be a member of the given companyId. If companyId is
// undefined, only login is checked (the method is responsible for deriving
// its scope from the caller's profile). If companyId is provided, it must
// match the caller's companyId - preventing cross-tenant spoofing.
export async function requireCompanyMember(invocation, companyId) {
  if (isServerInternal(invocation)) return;
  if (!invocation.userId) {
    throw new Meteor.Error(401, 'Login required');
  }
  if (companyId === undefined) return;
  if (!companyId || typeof companyId !== 'string') {
    throw new Meteor.Error(400, 'companyId required');
  }
  const callerCompany = await getCallerCompanyId(invocation.userId);
  if (callerCompany !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
}

// Require the caller's company to own the project identified by projectId.
// Used for project-scoped integrations (GitHub, TFS, Jira link methods).
export async function requireProjectAccess(invocation, projectId) {
  if (isServerInternal(invocation)) return;
  if (!invocation.userId) {
    throw new Meteor.Error(401, 'Login required');
  }
  if (!projectId || typeof projectId !== 'string') {
    throw new Meteor.Error(400, 'projectId required');
  }
  const project = await Projects.findOneAsync(projectId, {fields: {companyId: 1}});
  if (!project) {
    throw new Meteor.Error(404, 'Project not found');
  }
  const callerCompany = await getCallerCompanyId(invocation.userId);
  if (project.companyId !== callerCompany) {
    throw new Meteor.Error(403, 'Access Denied');
  }
}

// Require the caller's company to own the module identified by moduleId.
export async function requireModuleAccess(invocation, moduleId) {
  if (isServerInternal(invocation)) return;
  if (!invocation.userId) {
    throw new Meteor.Error(401, 'Login required');
  }
  if (!moduleId || typeof moduleId !== 'string') {
    throw new Meteor.Error(400, 'moduleId required');
  }
  const module = await Modules.findOneAsync(moduleId, {fields: {companyId: 1}});
  if (!module) {
    throw new Meteor.Error(404, 'Module not found');
  }
  const callerCompany = await getCallerCompanyId(invocation.userId);
  if (module.companyId !== callerCompany) {
    throw new Meteor.Error(403, 'Access Denied');
  }
}
