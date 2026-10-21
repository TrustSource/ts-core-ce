import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import Companies from '/imports/lib/collections/companies';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import {decrypt} from '/imports/lib/crypto';

async function getJiraCredentials(projectId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return {};
  }

  let settings = {};
  const company = await Companies.findOneAsync(companyId, {fields: {jira: 1}});
  if (company && company.jira && company.jira.active) {
    let {url, user, passwd, key, type, email} = company.jira;
    if (passwd) {
      passwd = decrypt(passwd);
    }
    settings = {url, user, passwd, key, type, email, companyId};
  }
  // A project of the caller's own company only, named by a plain string id: a selector
  // object or another company's project id must never reach its decrypted password.
  const project = typeof projectId === 'string' && projectId ?
    await Projects.findOneAsync({_id: projectId, companyId}, {fields: {jira: 1}}) : null;
  if (project && project.jira && project.jira.active) {
    if (project.jira.passwd) {
      project.jira.passwd = decrypt(project.jira.passwd);
    }
    let {url, user, passwd, key, type, email} = _.extend(settings, Utils.removeEmpty(project.jira));
    settings = {url, user, passwd, key, type, email, companyId};
  }
  return settings || {};
}

export default getJiraCredentials;
