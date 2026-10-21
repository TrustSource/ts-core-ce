// Read a multipart/form-data request body for the REST upload routes, with limits.
//
// The parsers this replaces buffered every byte of every file in memory with no
// limit, before any route checked the API key. This streams the request through
// busboy, keeps one file and the form fields, and gives up at the first byte past
// `maxBytes` - the remaining upload is discarded, not buffered.
//
// Resolves with {documentContent, filename, encoding, mimeType, ...fields}
// (documentContent is absent when the body carries no file). Rejects with
// {status, message}: 413 for a file over the limit, 400 for a second file or a
// malformed body.
//
// CommonJS with busboy passed in, so Jest can drive it with the real busboy.

// Form fields are metadata (a document type, an API key); busboy's default 1 MB
// per field value still applies.
const MAX_FIELDS = 50;

function readMultipartBody(req, {Busboy, maxBytes}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (status, message) => {
      if (settled) return;
      settled = true;
      req.unpipe();
      req.resume();   // drain what is left without keeping it
      reject({status, message});
    };

    let busboy;
    try {
      // busboy reports `limit` once a file REACHES fileSize, so allow one byte
      // more: a file of exactly maxBytes is accepted, one byte over is not.
      busboy = Busboy({headers: req.headers, limits: {files: 1, fileSize: maxBytes + 1, fields: MAX_FIELDS}});
    } catch (error) {
      fail(400, String(error && error.message || error));
      return;
    }

    const body = {};
    const chunks = [];
    busboy.on('file', (name, file, info) => {
      body.filename = info.filename;
      body.encoding = info.encoding;
      body.mimeType = info.mimeType;
      file.on('data', (chunk) => {
        chunks.push(chunk);
      });
      file.on('limit', () => {
        fail(413, `File exceeds the upload limit of ${maxBytes} bytes`);
      });
      file.on('end', () => {
        if (!file.truncated) {
          body.documentContent = Buffer.concat(chunks);
        }
      });
    });
    busboy.on('filesLimit', () => {
      fail(400, 'Only one file may be uploaded per request');
    });
    busboy.on('field', (fieldname, value) => {
      body[fieldname] = value;
    });
    busboy.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(body);
    });
    busboy.on('error', (error) => {
      fail(400, String(error && error.message || error));
    });
    req.pipe(busboy);
  });
}

module.exports = {readMultipartBody};
