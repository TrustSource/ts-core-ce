import {Meteor} from 'meteor/meteor';
import {httpCall} from '/imports/lib/httpFetch';
import {ProjectsGetJiraCredentials} from '/imports/lib/interactors/projects';
import {tsWebhook} from '/imports/startup/server/ts-webhook';
import {requireProjectAccess} from '/imports/server/security/methodGuards';

async function getApiParams(data, projectId) {
  const {url, user, passwd, type, email, companyId} = await ProjectsGetJiraCredentials(projectId);
  if(type !== 'email'){
    const options = {
      headers: {
        'Content-Type': 'application/json'
      },
      auth: `${user}:${passwd}`,
      // The Jira base URL is user-supplied (company/project settings), so every
      // Jira httpCall opts into SSRF egress validation: the resolved target and
      // each redirect hop are refused if they point at an internal address. The
      // SSRF_BLOCKED error is caught by each method's try/catch, returning the
      // safe failure path to the client - never the internal response.
      validateEgress: true
    };
    if (data) {
      options.data = data;
    }
    return {url: url + '/rest/api/2/', options, type, companyId};
  }else{
    return {email, type, companyId};
  }
}

Meteor.methods({
  jiraGetMeta: async function (key, projectId) {
    await requireProjectAccess(this, projectId);
    this.unblock();

    const {url, options} = await getApiParams(null, projectId);
    try {
      //issue/ECST-176
      return await httpCall('GET', url + 'issue/createmeta?projectKeys=' + key, options);
    } catch (e) {
      console.log('jiraGetMeta problem: ', e.response);
      return false;
    }
  },

  jiraCreateIssue: async function (data, projectId) {
    await requireProjectAccess(this, projectId);
    this.unblock();

    const {url, options, email, type, companyId} = await getApiParams(data, projectId);
    if(!type || type !== 'email'){
      try {
        //issue/ECST-179,ECST-178
        return await httpCall('POST', url + 'issue/', options);
      } catch (e) {
        console.log('jiraCreateIssue problem: ', e);
        return 'Internal error. Please contact support';
      } finally {
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
      }
    }else{
      if(data.fields && email){
        await Meteor.callAsync('_sendEmail', email, data.fields.summary,
          data.fields.description);
        return {data:{key:'EMAILED'}}
      }
    }
  },

  jiraRemoveIssue: async function (key, projectId) {
    await requireProjectAccess(this, projectId);
    this.unblock();

    const {url, options} = await getApiParams(null, projectId);
    try {
      //issue/ECST-179,ECST-178
      return await httpCall('DELETE', url + 'issue/' + key, options);
    } catch (e) {
      console.log('jiraDeleteIssue problem: ', e);
      return 'Internal error. Please contact support';
    }
  },

  jiraGetIssue: async function (key, projectId) {
    await requireProjectAccess(this, projectId);
    this.unblock();

    const {url, options} = await getApiParams(null, projectId);
    try {
      //issue/ECST-176
      return await httpCall('GET', url + 'issue/' + key, options);
    } catch (e) {
      console.log('jiraGetIssue: ', e);
      return false;
    }
  },

  jiraGetIssueList: async function (projectId,jiraKey) {
    await requireProjectAccess(this, projectId);
    this.unblock();

    const {url, options} = await getApiParams(null, projectId);
    try {
      return await httpCall('GET', url + 'search?jql=project%20%3D%20'+jiraKey+
        '%20AND%20labels%20in%20(trustsource_issue%2C%20trustource_problem)', options);
    } catch (e) {
      console.log('jiraGetIssueList: ', e);
      return false;
    }
  }
});
