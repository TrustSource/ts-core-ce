import fs from 'fs';
import SPDXFiles from '/imports/lib/collections/SPDXFiles';
import {SPDXTypes} from '/imports/lib/spdx'

const create = async function({fileName, filePath, type}, callback) {
  const fileData = fs.readFileSync(filePath);
  const fileRef = await SPDXFiles.writeAsync(fileData, {
    fileName: fileName,
    type: SPDXTypes[type].fileType || 'text/plain'
  });
  if (callback) {
    callback({fileName, filePath, type, fileObject: fileRef});
  }
  return fileRef;
};

export default create;
