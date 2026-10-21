import {Meteor} from 'meteor/meteor';
import ModuleImports from '/imports/lib/collections/moduleImports';
import Projects from '/imports/lib/collections/projects';

Meteor.publish('moduleImports', async function (projectId) {
  if (!this.userId || !projectId) {
    return this.ready();
  }
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return this.ready();
  }
  // moduleImports has no companyId of its own - verify the project it belongs
  // to is owned by the subscriber's company before exposing its imports.
  const project = await Projects.findOneAsync(projectId, {fields: {companyId: 1}});
  if (!project || project.companyId !== companyId) {
    return this.ready();
  }
  return ModuleImports.find({'meta.projectId': projectId}).cursor;
});

// Clients never write ModuleImports documents: an upload is stored through ostrio's own
// server methods, and ModuleImports.ImportModule sets the import status on the server. Both
// are server-side writes, which these rules do not govern. A client write would let the
// uploader point a document's file path (versions.*.path) or project (meta.projectId)
// anywhere.
ModuleImports.deny({
  insert() {
    return true;
  },
  update() {
    return true;
  },
  remove() {
    return true;
  }
});
