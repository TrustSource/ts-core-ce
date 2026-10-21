/* global Buffer:false */
import {Meteor} from 'meteor/meteor';
import {httpCall} from '/imports/lib/httpFetch';
import _ from 'underscore';
import {requireLogin} from '/imports/server/security/methodGuards';
import Companies from '/imports/lib/collections/companies';
import {decryptV2Only, encrypt, VERSION_PREFIX} from '/imports/lib/crypto';
const {sealPlaintextLeanixTokens} = require('/imports/server/security/leanixToken');

const apiBase = 'https://app.leanix.net/';
const apiVersion = '/api/v1/';
const TS = 'TrustSource: '

// The company's LeanIX API token, decrypted on the server only. A token saved
// before tokens were encrypted is still plaintext and used as it is.
async function companyLeanixToken(userId) {
  const user = await Meteor.users.findOneAsync(userId, {fields: {profile: 1}});
  const companyId = user && user.profile && user.profile.companyId;
  const company = companyId && await Companies.findOneAsync(companyId, {fields: {'leanix.token': 1}});
  const stored = company && company.leanix && company.leanix.token;
  return stored ? decryptV2Only(stored) : null;
}

// Tokens saved before they were encrypted are encrypted on startup.
Meteor.startup(async function () {
  if (!process.env.TS_ENCRYPTION_KEY && !process.env.TS_ENCRYPTION_KEY_LEGACY) {
    return;
  }
  try {
    const sealed = await sealPlaintextLeanixTokens(Companies, {encrypt, VERSION_PREFIX});
    if (sealed) {
      console.log(`=> Encrypted ${sealed} LeanIX tokens stored in plaintext`);
    }
  } catch (error) {
    console.log('=> LeanIX tokens could not be encrypted:', error && error.message);
  }
});

Meteor.methods({
  // Logs in to LeanIX with the company's stored token. The token never reaches the
  // browser; only the short-lived access token comes back.
  leanixLogin: async function () {
    requireLogin(this);
    this.unblock();
    const apiToken = await companyLeanixToken(this.userId);
    if (!apiToken) {
      return false;
    }
    const token = Buffer.from('apitoken:' + apiToken, 'utf8').toString('base64');
    try {
      return await httpCall('POST', apiBase + 'services/mtm/v1/oauth2/token',
        {
          headers: {'authorization': 'Basic ' + token, 'Content-Type': 'application/x-www-form-urlencoded'},
          params: {
            'grant_type': 'client_credentials'
          }
        }
      );
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (_e) {
      return false;
    }
  },
  leanixProjects: async function (token, appName) {
    requireLogin(this);
    this.unblock();
    if (token && appName) {
      try {
        let model = [{
          optgroup: 'Projects',
          options: []
        }, {
          optgroup: 'Tech. Stacks',
          options: []
        }, {
          optgroup: 'IT Components',
          options: []
        }, {
          optgroup: 'Applications',
          options: []
        }];
        const projects = await httpCall('GET', apiBase + appName + apiVersion + 'projects?relations=false',
          {headers: {authorization: 'Bearer ' + token}}
        );
        const resourceCapabilities = await httpCall('GET', apiBase + appName + apiVersion + 'resourceCapabilities?relations=false',
          {headers: {authorization: 'Bearer ' + token}}
        );
        const resources = await httpCall('GET', apiBase + appName + apiVersion + 'resources?relations=false',
          {headers: {authorization: 'Bearer ' + token}}
        );
        const services = await httpCall('GET', apiBase + appName + apiVersion + 'services?relations=false',
          {headers: {authorization: 'Bearer ' + token}}
        );
        model[0].options = _.map(projects.data, function (c) {
          return {label: c.displayName, value: appName + '++' + c.resourceType + '++' + c.ID};
        });
        model[1].options = _.map(resourceCapabilities.data, function (c) {
          return {label: c.displayName, value: appName + '++' + c.resourceType + '++' + c.ID};
        });
        model[2].options = _.map(resources.data, function (c) {
          return {label: c.displayName, value: appName + '++' + c.resourceType + '++' + c.ID};
        });
        model[3].options = _.map(services.data, function (c) {
          return {label: c.displayName, value: appName + '++' + c.resourceType + '++' + c.ID};
        });
        return model;
      } catch (e) {
        console.log('leanixProjects: ' + e);
        return false;
      }
    }
  },
   
  leanixProjectsUpdate: async function (token, data, remove, url, ecsType) {
    requireLogin(this);
    this.unblock();
    if (data.leanix) {

      const leanixApp = data.leanix.split('++')[0];
      const leanixType = data.leanix.split('++')[1];
      const leanixId = data.leanix.split('++')[2];
      try {
        const moduleResult = await httpCall('GET', apiBase + leanixApp + apiVersion + leanixType + '/' + leanixId + '?relations=true',
          {
            headers: {authorization: 'Bearer ' + token}
          }
        );
        const moduleGet = moduleResult.data;
        if (moduleGet != null) {
          const documentsResult = await httpCall('GET', apiBase + leanixApp + apiVersion + 'documents?relations=true',
            {
              headers: {authorization: 'Bearer ' + token}
            }
          );
          const documentsGet = documentsResult.data;
          let currentDocument = _.find(documentsGet, function (doc) {
            return doc.name == TS + data.name
          });
          if (currentDocument && currentDocument.length != 0) {
            if (remove) {
              let relation = _.find(currentDocument.factSheetHasDocuments, function (doc) {
                return doc.factSheetID == leanixId
              });
              if (relation) {
                await httpCall('DELETE', apiBase + leanixApp + apiVersion
                  + leanixType + '/' + leanixId + '/factSheetHasDocuments/' + relation.ID,
                {
                  headers: {authorization: 'Bearer ' + token}
                }
                )
              }
            } else {
              let postDocumentLink = {
                'factSheetID': leanixId,
                'documentID': currentDocument.ID
              };
              await httpCall('POST', apiBase + leanixApp + apiVersion + leanixType + '/' + leanixId + '/factSheetHasDocuments',
                {
                  headers: {authorization: 'Bearer ' + token},
                  data: postDocumentLink
                }
              )
            }
          } else {
            if (!remove) {
              let postDocument = {
                'name': TS + data.name,
                'url': url,
                'topic': 'TrustSource',
                'description': 'TrustSource ' + ecsType + ' link'
              };
              const docResult = await httpCall('POST', apiBase + leanixApp + apiVersion + 'documents',
                {
                  headers: {authorization: 'Bearer ' + token},
                  data: postDocument
                }
              );
              currentDocument = docResult.data;
              let postDocumentLink = {
                'factSheetID': leanixId,
                'documentID': currentDocument.ID
              };
              await httpCall('POST', apiBase + leanixApp + apiVersion + leanixType + '/' + leanixId + '/factSheetHasDocuments',
                {
                  headers: {authorization: 'Bearer ' + token},
                  data: postDocumentLink
                }
              )
            }
          }
          let contentData = {
            tags: moduleGet.tags
          };
          if (remove) {
            const i = contentData.tags.indexOf(TS + data.name);
            if (i != -1) {
              contentData.tags.splice(i, 1);
            }
          } else {
            contentData.tags.push(TS + data.name);
          }
          return await httpCall('PUT', apiBase + leanixApp + apiVersion + leanixType + '/' + leanixId,
            {
              headers: {authorization: 'Bearer ' + token},
              data: contentData
            }
          );
        }
      } catch (e) {
        console.log('leanixProjectsUpdate: ' + e);
        return false;
      }
    }
  }
});
//}
