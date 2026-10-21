import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import Companies from '/imports/lib/collections/companies';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import {decrypt} from '/imports/lib/crypto';

async function getGithubCredentials(projectId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return {};
  }
  let settings = {};
  const company = await Companies.findOneAsync(companyId, {fields: {github: 1}});
  if (company && company.github && company.github.active) {
    let {token} = company.github;
    if (token) {
      token = decrypt(token);
    }
    settings = {token, companyId};
  }
  // A project of the caller's own company only, named by a plain string id: a selector
  // object or another company's project id must never reach its decrypted token.
  const projectObj = typeof projectId === 'string' && projectId ?
    await Projects.findOneAsync({_id: projectId, companyId}, {fields: {github: 1}}) : null;
  if (projectObj && projectObj.github && projectObj.github.active) {
    if (projectObj.github.token) {
      projectObj.github.token = decrypt(projectObj.github.token);
    }
    let {token} = _.extend(settings, Utils.removeEmpty(projectObj.github));
    settings = {token, companyId};
  }
  return settings || {};
}

export default getGithubCredentials;
