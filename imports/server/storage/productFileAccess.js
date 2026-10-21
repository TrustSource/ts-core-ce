import {Meteor} from 'meteor/meteor';
import RestApi from '/imports/server/rest-api/RestApi';
import {accountStatusOf, ACCOUNT_STATUS} from '/imports/lib/accountStatus';

// Who may download product documents and photos (/files/products/...): a signed-in
// member of the owning company, or a REST client presenting an API key of it.
//
// A browser request carries the DDP session id in the `x_mtok` cookie, which
// ostrio:files sets on every client for its own protected downloads; it maps to
// the logged-in user of that live session. REST clients send their `x-api-key`.

function cookieValue(header, name) {
  if (typeof header !== 'string') {
    return null;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > -1 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

function sessionUserId(token) {
  const sessions = Meteor.server && Meteor.server.sessions;
  const session = sessions instanceof Map ? sessions.get(token) : null;
  return (session && session.userId) || null;
}

/**
 * @param {Object} request the incoming HTTP request
 * @returns {Promise<String|null>} the company whose files the caller may read
 */
export async function companyOfFileReader(request) {
  const headers = (request && request.headers) || {};
  const token = headers['x-mtok'] || cookieValue(headers.cookie, 'x_mtok');
  const userId = typeof token === 'string' && token ? sessionUserId(token) : null;
  if (userId) {
    const user = await Meteor.users.findOneAsync(userId, {fields: {profile: 1, accountStatus: 1}});
    if (user && accountStatusOf(user) === ACCOUNT_STATUS.ACTIVE) {
      return (user.profile && user.profile.companyId) || null;
    }
    return null;
  }
  const apiKey = headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey) {
    const auth = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(apiKey);
    return auth && auth.company ? auth.company._id : null;
  }
  return null;
}
