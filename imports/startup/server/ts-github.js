import {Meteor} from 'meteor/meteor';
import {Octokit} from '@octokit/core';
import gh from 'parse-github-url';
import {ProjectsGetGithubCredentials} from '/imports/lib/interactors/projects';
import {requireProjectAccess} from '/imports/server/security/methodGuards';
import {tsWebhook} from '/imports/startup/server/ts-webhook';

const GITHUB_API_VERSION = '2022-11-28'

Meteor.methods({
  tsGithubCreateIssue: async function (projectId, repo, title, body) {
    await requireProjectAccess(this, projectId);
    try {
      if(repo){
        const data = gh(repo)
        if(data && data.owner && data.name){
          const {token, companyId} = await ProjectsGetGithubCredentials(projectId);
          const octokit = new Octokit({ auth: token });
          let options = {
            owner: data.owner,
            repo: data.name,
            title,
            body,
            labels: [
              'bug',
              'trustsource_issue'
            ],
            headers: {
              'X-GitHub-Api-Version': GITHUB_API_VERSION
            }
          }
          try {
            await tsWebhook({
              companyId: companyId,
              projectId: projectId,
              trigger: 'task',
              data: {
                details: options
              }
            });
          }catch (e) {console.log(e)}
          return await octokit.request('POST /repos/{owner}/{repo}/issues', options)
        }
      }
    }catch (e) {
      console.log('tsGithubCreateIssue', e)
      throw new Meteor.Error('github-error', e.status ? 'GitHub API error: ' + e.status : 'GitHub integration error');
    }
  },
  tsGithubGetIssue: async function (projectId, repo, issue) {
    await requireProjectAccess(this, projectId);
    try {
      if(repo){
        const data = gh(repo)
        if(data && data.owner && data.name){
          const {token} = await ProjectsGetGithubCredentials(projectId);
          const octokit = new Octokit({ auth: token });
          return await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
            owner: data.owner,
            repo: data.name,
            issue_number: issue,
            headers: {
              'X-GitHub-Api-Version': GITHUB_API_VERSION
            }
          })
        }
      }
    }catch (e) {
      console.log('tsGithubGetIssue', e)
      throw new Meteor.Error('github-error', e.status ? 'GitHub API error: ' + e.status : 'GitHub integration error');
    }
  },
  tsGithubGetIssueList: async function (projectId, repo) {
    await requireProjectAccess(this, projectId);
    try {
      if(repo){
        const data = gh(repo)
        if(data && data.owner && data.name){
          const {token} = await ProjectsGetGithubCredentials(projectId);
          const octokit = new Octokit({ auth: token });
          return await octokit.request('GET /repos/{owner}/{repo}/issues', {
            owner: data.owner,
            repo: data.name,
            state: 'all',
            headers: {
              'X-GitHub-Api-Version': GITHUB_API_VERSION
            }
          })
        }
      }
    }catch (e) {
      console.log('tsGithubGetIssue', e)
      throw new Meteor.Error('github-error', e.status ? 'GitHub API error: ' + e.status : 'GitHub integration error');
    }
  },
  tsGithubRemoveIssue: async function (projectId, repo, issue) {
    await requireProjectAccess(this, projectId);
    try {
      if(repo){
        const data = gh(repo)
        if(data && data.owner && data.name){
          const {token} = await ProjectsGetGithubCredentials(projectId);
          const octokit = new Octokit({ auth: token });
          return await octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
            owner: data.owner,
            repo: data.name,
            issue_number: issue,
            state: 'closed',
            headers: {
              'X-GitHub-Api-Version': GITHUB_API_VERSION
            }
          })
        }
      }
    }catch (e) {
      console.log('tsGithubRemoveIssue', e)
      throw new Meteor.Error('github-error', e.status ? 'GitHub API error: ' + e.status : 'GitHub integration error');
    }
  }
});
