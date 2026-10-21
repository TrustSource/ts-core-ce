import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';

// ts-scan (upload --wait-for-analysis) prints a result link it builds from its API
// base URL: <base>/projects/<projectId>/modules/<moduleId>/dependencies?analysis=<scanId>.
// Against CE the base is <ROOT_URL>/api, so the link lands here. Send it on to the
// module page, with the analysis of that scan when there is one.
const ID = /^[A-Za-z0-9]{1,64}$/;

Router.route('/api/projects/:projectId/modules/:moduleId/dependencies', {
  name: 'apiAppLinkRedirect',
  where: 'server',
  action: async function () {
    await redirectToModulePage(this.params, this.response);
  }
});

export async function redirectToModulePage(params, response) {
  const {projectId, moduleId} = params;
  if (!ID.test(projectId || '') || !ID.test(moduleId || '')) {
    response.writeHead(404, {'Content-Type': 'text/plain'});
    response.end('Page not found');
    return;
  }
  let target = `projects/${projectId}/modules/${moduleId}/dependencies`;
  const scanId = params.query && params.query.analysis;
  if (typeof scanId === 'string' && ID.test(scanId)) {
    // ts-scan passes the scan id; the page expects the analysis id.
    const analysis = await ModuleAnalysis.findOneAsync({scanId, moduleId},
      {sort: {date: -1}, fields: {_id: 1}});
    if (analysis) {
      target += `?analysis=${encodeURIComponent(analysis._id)}`;
    }
  }
  response.writeHead(302, {Location: Meteor.absoluteUrl(target)});
  response.end();
}
