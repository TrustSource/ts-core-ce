import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import VulnerabilityAlertState from '/imports/lib/collections/vulnerabilityAlertState';

const remove = async function (projectId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'developer'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const project = await Projects.findOneAsync(projectId, {fields: {companyId: 1}});
  if (!project || project.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await Projects.removeAsync(projectId);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not delete from db');
  }
  // The alert baseline is the one thing keyed by this project that
  // nothing else would ever clear: it has no publication and no UI, so an
  // orphaned row would sit in the collection for the life of the deployment, and
  // a project id reused by a restore would inherit somebody else's "already
  // alerted" list. Both selectors carry companyId. Release-scope rows are found
  // by projectId, which is exactly why the row stores it alongside scopeId.
  //
  // AFTER the removal and in its own try/catch: the project IS gone, so a
  // cleanup failure must not report the deletion as failed. A leftover row is
  // inert.
  try {
    await VulnerabilityAlertState.removeAsync({companyId, projectId});
  } catch (error) {
    console.info('=> vulnerability alert state cleanup failed for', projectId, ':',
      (error && error.message) || error);
  }
};

export default remove;
