import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import Companies from '/imports/lib/collections/companies';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import {decrypt} from '/imports/lib/crypto';

async function getTfsCredentials(projectId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return {};
  }

  let settings = {};
  const company = await Companies.findOneAsync(companyId, {fields: {tfs: 1}});
  if (company && company.tfs && company.tfs.active) {
    let {account, project, token} = company.tfs;
    if (token) {
      token = decrypt(token);
    }
    settings = {account, project, token, companyId};
  }
  // A project of the caller's own company only, named by a plain string id: a selector
  // object or another company's project id must never reach its decrypted token.
  const projectObj = typeof projectId === 'string' && projectId ?
    await Projects.findOneAsync({_id: projectId, companyId}, {fields: {tfs: 1}}) : null;
  if (projectObj && projectObj.tfs && projectObj.tfs.active) {
    if (projectObj.tfs.token) {
      projectObj.tfs.token = decrypt(projectObj.tfs.token);
    }
    let {account, project, token} = _.extend(settings, Utils.removeEmpty(projectObj.tfs));
    settings = {account, project, token, companyId};
  }
  return settings || {};
}

export default getTfsCredentials;
