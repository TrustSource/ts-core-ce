import {WebApp} from 'meteor/webapp';
import {isFilesHttpUploadRequest} from '/imports/server/security/uploadGuards';

// ostrio:files serves an HTTP upload route next to its downloads
// (POST /cdn/storage/<collection>/__upload). It reads the whole request body
// before any hook runs and accepted uploads from anonymous clients. The app
// uploads over DDP only, so the route is refused here - on the raw handlers,
// which run before ostrio's own - without reading the body.
WebApp.rawConnectHandlers.use(function (req, res, next) {
  if (!isFilesHttpUploadRequest(req)) {
    next();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Connection', 'close');
  res.writeHead(403);
  res.end(JSON.stringify({error: 'File uploads go through the application'}), () => req.destroy());
});
