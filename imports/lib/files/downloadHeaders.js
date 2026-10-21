// Response headers for downloading stored files (ostrio:files `responseHeaders`).
//
// ostrio serves a file inline, with the Content-Type its uploader declared. A
// file declared as text/html was therefore rendered on the app's own origin when
// a colleague opened its download link. Every download link in the app already
// asks for a download (`<a download>`); these headers make the server agree:
// always an attachment, never sniffed. The range and error headers ostrio's
// default adds are kept.
//
// CommonJS with no meteor/* imports so Jest can require it directly.

function contentDisposition(name) {
  const safeName = String(name || 'download');
  return `attachment; filename="${encodeURI(safeName).replace(/,/g, '%2C')}"; ` +
    `filename*=UTF-8''${encodeURIComponent(safeName)}; charset=UTF-8`;
}

function attachmentResponseHeaders(responseCode, fileRef, versionRef) {
  const vRef = versionRef || {};
  const headers = {};
  switch (responseCode) {
  case '206':
    headers.Pragma = 'private';
    headers['Transfer-Encoding'] = 'chunked';
    break;
  case '400':
    headers['Cache-Control'] = 'no-cache';
    break;
  case '416':
    headers['Content-Range'] = `bytes */${vRef.size}`;
    break;
  default:
    break;
  }
  headers.Connection = 'keep-alive';
  headers['Content-Type'] = vRef.type || 'application/octet-stream';
  headers['Accept-Ranges'] = 'bytes';
  headers['Content-Disposition'] = contentDisposition(vRef.name || (fileRef && fileRef.name));
  headers['X-Content-Type-Options'] = 'nosniff';
  return headers;
}

module.exports = {attachmentResponseHeaders};
