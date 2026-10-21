import {Meteor} from 'meteor/meteor';
import SPDXExports from '/imports/lib/collections/SPDXExports';

Meteor.publish('SPDXExports', async function (moduleId) {
  if(moduleId && this.userId){
    return SPDXExports.find({userId: this.userId, moduleId});
  }
  this.ready();
});

// Written only by server methods. The SPDX file download check trusts these
// documents, so a client insert could point one at another company's file.
SPDXExports.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

