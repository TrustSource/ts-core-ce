// Pure upload decisions, CommonJS so Jest can require them directly. The runtime
// wiring lives in imports/startup/server/files-upload-guard.js and
// imports/server/rest-api/RestApi.js.

// Upper bound for one file sent to a REST upload route, in MB (TS_UPLOAD_MAX_MB).
const DEFAULT_UPLOAD_MAX_MB = 50;

function uploadMaxBytes(env) {
  const mb = Number((env || {}).TS_UPLOAD_MAX_MB);
  const valid = Number.isFinite(mb) && mb > 0;
  return Math.floor((valid ? mb : DEFAULT_UPLOAD_MAX_MB) * 1024 * 1024);
}

// ostrio:files' HTTP upload route: POST <downloadRoute>/<collection>/__upload.
// It reads the whole body before any hook runs and accepts anonymous uploads.
// The app uploads over DDP only, so this route is refused outright.
const FILES_HTTP_UPLOAD = /^\/cdn\/storage\/[^/?]+\/__upload(?:\?|$)/;

function isFilesHttpUploadRequest(req) {
  return !!req && typeof req.method === 'string' && req.method.toUpperCase() === 'POST' &&
    typeof req.url === 'string' && FILES_HTTP_UPLOAD.test(req.url);
}

module.exports = {DEFAULT_UPLOAD_MAX_MB, uploadMaxBytes, isFilesHttpUploadRequest};
