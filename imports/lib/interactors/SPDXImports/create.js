import SPDXFiles from '/imports/lib/collections/SPDXFiles';
import SPDXImports from '/imports/lib/collections/SPDXImports';

const create = async function ({userId, projectId, file}) {
  const fileRef = await SPDXFiles.writeAsync(file.data || file, {
    fileName: file.name || 'upload',
    type: file.type || 'text/plain'
  });
  const doc = {
    userId,
    projectId,
    originalId: fileRef._id,
    rdfFileId: null,
    status: 'created',
    created: new Date(),
    updated: new Date()
  };
  return SPDXImports.insertAsync(doc);
};

export default create;
