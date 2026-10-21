import _ from 'underscore';
import {PolicySchema} from '/imports/lib/schemas/policySchema';
import policyFiles from '/imports/lib/collections/policyFiles'

const PolicyItem = function (doc) {
  _.extend(this, doc);

  this.fileData = function () {
    const fileDoc = this.file && policyFiles.collection.findOne(this.file);
    if (fileDoc) {
      fileDoc.url = function () {
        return policyFiles.link(fileDoc);
      };
    }
    return fileDoc;
  };
};

PolicyItem.prototype.validate = function () {
  const context = PolicySchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

export default PolicyItem;
