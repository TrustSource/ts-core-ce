import {Meteor} from 'meteor/meteor';
import SPDXFiles from '/imports/lib/collections/SPDXFiles';
import SPDXImports from '/imports/lib/collections/SPDXImports';

Meteor.publish('SPDXFilesImports', async function (projectId) {
  if(this.userId && projectId){
    const imp = await SPDXImports.findOneAsync({
      userId: this.userId,
      projectId
    });
    if(imp){
      return SPDXFiles.collection.find({projectId});
    }
  }
  this.ready();
});

Meteor.publish('SPDXFilesExports', async function (moduleId) {
  if(this.userId && moduleId){
    const imp = await SPDXImports.findOneAsync({
      userId: this.userId,
      moduleId
    });
    if(imp){
      return SPDXFiles.collection.find({moduleId});
    }
  }
  this.ready();
});
