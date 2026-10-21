import {Meteor} from 'meteor/meteor';
import SPDXImports from '/imports/lib/collections/SPDXImports';

Meteor.publish('SPDXImports', async function (projectId) {
  if(this.userId && projectId){
    return SPDXImports.find({userId: this.userId, projectId});
  }
  this.ready();
});

// Written only by server methods. The SPDX file download check trusts these
// documents, so a client insert could point one at another company's file.
SPDXImports.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});
