import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {pipeline} from 'stream';
import {PRODUCT_FILES_FOLDER, productFileContentType} from '/imports/server/storage/storagePaths';
import {statFile, openReadStream} from '/imports/server/storage/fileStorage';
import {companyOfFileReader} from '/imports/server/storage/productFileAccess';

// Product documents and photos, readable by signed-in members of the owning company
// and by REST clients with one of its API keys (productFileAccess.js). Always a
// download, never rendered on the app origin: attachment, nosniff and a sandbox CSP.
Router.route('/files/products/:companyId/:name', {
  name: 'productFileDownload',
  where: 'server',
  action: async function () {
    await serveProductFile(this.request, this.response, this.params);
  }
});

function notFound(response) {
  response.writeHead(404, {'Content-Type': 'text/plain'});
  response.end('File not found');
}

export async function serveProductFile(request, response, params) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {'Content-Type': 'text/plain', 'Allow': 'GET, HEAD'});
    response.end('Method Not Allowed');
    return;
  }
  // Not found rather than forbidden: a stranger does not learn whether the file exists.
  if (await companyOfFileReader(request) !== params.companyId) {
    notFound(response);
    return;
  }
  const ref = {companyId: params.companyId, folder: PRODUCT_FILES_FOLDER, name: params.name};
  let stats = null;
  try {
    stats = await statFile(ref);
  } catch {
    // an invalid company/name pair fails the storage path guard; treat as not found
  }
  if (!stats) {
    notFound(response);
    return;
  }
  response.writeHead(200, {
    'Content-Type': productFileContentType(params.name),
    'Content-Length': stats.size,
    'Content-Disposition': `attachment; filename="${params.name}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    // private: a shared cache must not hand the file to someone who may not read it.
    'Cache-Control': 'private, max-age=31536000, immutable'
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  // pipeline destroys both ends on either a read error or the response closing
  // early (a client abort), which plain .pipe() does not do - a stalled download
  // left the source file descriptor open until the process ran out of them.
  pipeline(openReadStream(ref), response, (error) => {
    if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error('productFileDownload: read failed for', params.name, error.message);
    }
  });
}
