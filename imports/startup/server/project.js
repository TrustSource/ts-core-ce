import {Meteor} from 'meteor/meteor';
import {
  ProjectsUpdateTfs, ProjectsUpdateJira, ProjectsGetTfsCredentials, ProjectsGetJiraCredentials,
  ProjectsUpdateGithub, ProjectsGetGithubCredentials, ProjectsUpdateEndoflifePolicy,
  ProjectsUpdateRequirements, ProjectsUpdateObligationConfig,
  ProjectsUpdateCiaRequirements, ProjectsUpdateRequireWhitelist, ProjectsUpdateRelease,
  ProjectsUpdatePinnedBy, ProjectsCreate, ProjectsRemove, ProjectsUpdateArchitecture,
  ProjectsUpdateAutoCreateCweRisks
} from '/imports/lib/interactors/projects'

Meteor.methods({
  'Projects.UpdateTfs': ProjectsUpdateTfs,
  'Projects.UpdateJira': ProjectsUpdateJira,
  'Projects.UpdateGithub': ProjectsUpdateGithub,
  // The credential getters return decrypted secrets, so they are server-side only: a client
  // learns whether credentials exist, never their values.
  'Projects.GetTfsCredentials.exists?': async function(...args) {
    let {account, project, token} = await ProjectsGetTfsCredentials(...args);
    return !!(account && project && token);
  },
  'Projects.GetJiraCredentials.exists?': async function(...args) {
    let {url, key} = await ProjectsGetJiraCredentials(...args);
    return !!(url && key);
  },
  'Projects.GetGithubCredentials.exists?': async function(...args) {
    let {token} = await ProjectsGetGithubCredentials(...args);
    return !!(token);
  },
  'Projects.UpdateEndoflifePolicy': ProjectsUpdateEndoflifePolicy,
  'Projects.UpdateRequirements': ProjectsUpdateRequirements,
  'Projects.UpdateObligationConfig': ProjectsUpdateObligationConfig,
  'Projects.UpdateCiaRequirements': ProjectsUpdateCiaRequirements,
  'Projects.UpdateRequireWhitelist': ProjectsUpdateRequireWhitelist,
  // The toggle only stores the project setting; the reconcile that
  // runs after a SARIF import reads it and creates nothing while it is off.
  'Projects.UpdateAutoCreateCweRisks': ProjectsUpdateAutoCreateCweRisks,
  // Two arguments only: (projectId, settings). Everything else is
  // re-read server-side, so there is nothing a client could name that it does
  // not already own.
  'Projects.UpdateRelease': ProjectsUpdateRelease,
  'Projects.UpdatePinnedBy': ProjectsUpdatePinnedBy,
  'Projects.UpdateArchitecture': ProjectsUpdateArchitecture,
  // Replaces the deleted `Projects.allow({insert})` rule: an allow rule could not
  // trim the name, could not derive the tenant from the session, and could not
  // answer "that name is taken" at all.
  'Projects.Create': ProjectsCreate,
  'Projects.Remove': ProjectsRemove
});
