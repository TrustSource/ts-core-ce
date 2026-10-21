import {Meteor} from 'meteor/meteor';
import ModuleImports from '/imports/lib/collections/moduleImports';

const create = async function ({projectId, userId, file, type, moduleName}, callback) {
  const upload = ModuleImports.insert({
    file: file,
    chunkSize: 'dynamic',
    // `moduleName` is what the module gets called on the server; without it
    // the import falls back to the file name and builds a module named after the upload.
    meta: {projectId, userId, type, moduleName, status: 'CREATED', created: new Date()}
  }, false);

  upload.on('end', async function (error, fileObj) {
    if(!error){
      try {
        await Meteor.callAsync('ModuleImports.ImportModule', {projectId, userId, fileObj})
      } catch (e) {
        callback(e, fileObj)
        return
      }
    }
    callback(error, fileObj)
  });

  upload.start();
  return upload
};

export default create;
