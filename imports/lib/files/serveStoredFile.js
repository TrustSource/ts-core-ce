// Stream a file from local storage into a server route's HTTP response.
//
// A missing file is an expected state on a storage volume, so it answers 404 before any
// stream is opened: a ReadStream on a missing path emits an 'error', and with nothing
// listening that exception ends the whole server process. pipeline() then destroys both
// ends on a read error or when the client aborts, which .pipe() does not do (a stalled
// download kept its file descriptor open).
//
// CommonJS with no meteor/* imports so Jest can require it directly. It is imported by the
// shared router (imports/lib/router.js), which is bundled for the client too, so it requires
// no node core module itself: the server route action passes `fs` and `stream.pipeline` in.

const MISSING_FILE_CODES = ['ENOENT', 'ENOTDIR'];

async function statRegularFile(fs, filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile() ? stats : null;
  } catch (error) {
    if (MISSING_FILE_CODES.indexOf(error && error.code) === -1) {
      console.error('serveStoredFile: stat failed for', filePath, error && error.message);
    }
    return null;
  }
}

/**
 * @returns {Promise<boolean>} false when the file was answered with 404
 */
async function serveStoredFile({fs, pipeline, response, filePath, headers, notFoundMessage}) {
  const stats = typeof filePath === 'string' && filePath ? await statRegularFile(fs, filePath) : null;
  if (!stats) {
    response.writeHead(404, {'Content-Type': 'text/plain'});
    response.end(notFoundMessage || 'File not found');
    return false;
  }
  response.writeHead(200, headers || {});
  pipeline(fs.createReadStream(filePath), response, (error) => {
    if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error('serveStoredFile: read failed for', filePath, error.message);
    }
  });
  return true;
}

module.exports = {serveStoredFile};
