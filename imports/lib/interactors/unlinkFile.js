import fs from 'fs';

const unlinkFile = async function(path) {
  return new Promise((resolve) => {  
    fs.unlink(path, (error) => {
      if (error && error.code == 'ENOENT') {
        console.info(`${path} File doesn't exist, won't remove it.`)
      } else if (error) {
        console.error(`Error occurred while trying to remove file ${path}`);
      } else {
        console.info(`File ${path} was removed`);
      }
      resolve();
    });
  });
};

export default unlinkFile
