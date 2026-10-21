import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import {SPDXExportSchema} from '/imports/lib/schemas/SPDXExportSchema';
import SPDXFiles from '/imports/lib/collections/SPDXFiles'

const SPDXExport = function Component(doc) {
  _.extend(this, doc);

  this.user = function () {
    return this.userId && Meteor.users.findOne(this.userId);
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

  this.txtFile = function () {
    const fileDoc = this.txtFileId && SPDXFiles.collection.findOne(this.txtFileId);
    if (fileDoc) {
      fileDoc.url = function () {
        return SPDXFiles.link(fileDoc);
      };
    }
    return fileDoc;
  };

  this.xlsFile = function () {
    const fileDoc = this.xlsFileId && SPDXFiles.collection.findOne(this.xlsFileId);
    if (fileDoc) {
      fileDoc.url = function () {
        return SPDXFiles.link(fileDoc);
      };
    }
    return fileDoc;
  };
};

SPDXExport.prototype.validate = function () {
  const context = SPDXExportSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

export default SPDXExport;
