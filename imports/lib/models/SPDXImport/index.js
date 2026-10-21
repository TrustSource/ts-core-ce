import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import {SPDXImportSchema} from '/imports/lib/schemas/SPDXImportSchema';
import SPDXFiles from '/imports/lib/collections/SPDXFiles'
import Projects from '/imports/lib/collections/projects'

const SPDXImport = function Component(doc) {
  _.extend(this, doc);

  this.user = function () {
    return this.userId && Meteor.users.findOne(this.userId);
  };

  this.project = function () {
    return this.projectId && Projects.findOne(this.projectId);
  };

  this.original = function () {
    const fileDoc = this.originalId && SPDXFiles.collection.findOne(this.originalId);
    if (fileDoc) {
      fileDoc.url = function () {
        return SPDXFiles.link(fileDoc);
      };
    }
    return fileDoc;
  };

  this.rdfFile = function () {
    const fileDoc = this.rdfFileId && SPDXFiles.collection.findOne(this.rdfFileId);
    if (fileDoc) {
      fileDoc.url = function () {
        return SPDXFiles.link(fileDoc);
      };
    }
    return fileDoc;
  };
};

SPDXImport.prototype.validate = function () {
  const context = SPDXImportSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

export default SPDXImport;
