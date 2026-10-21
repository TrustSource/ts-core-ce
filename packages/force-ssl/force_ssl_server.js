var url = Npm.require("url");

//const meteorSettingsFile = process.env.METEOR_SETTINGS_FILE;

//if(!meteorSettingsFile) {// only force ssl, if env variable METEOR_SETTINGS_FILE is not set

  // Unfortunately we can't use a connect middleware here since
  // sockjs installs itself prior to all existing listeners
  // (meaning prior to any connect middlewares) so we need to take
  // an approach similar to overshadowListeners in
  // https://github.com/sockjs/sockjs-node/blob/cf820c55af6a9953e16558555a31decea554f70e/src/utils.coffee

  // Behind a TLS proxy, a request the proxy received over plain HTTP is sent to
  // ROOT_URL over HTTPS. Only when ROOT_URL is https and the proxy says the request
  // was http; the target host is always ROOT_URL's, never the request's Host header.
  function httpsRedirectTarget(rootUrl, forwardedProto, requestUrl) {
    if (!rootUrl || rootUrl.indexOf('https://') !== 0 || typeof forwardedProto !== 'string') {
      return null;
    }
    if (forwardedProto.split(',')[0].trim().toLowerCase() !== 'http') {
      return null;
    }
    var origin = rootUrl.replace(/^(https:\/\/[^/]+).*$/, '$1');
    var path = typeof requestUrl === 'string' && requestUrl.charAt(0) === '/' ? requestUrl : '/';
    return origin + path;
  }

  var httpServer = WebApp.httpServer;
  var oldHttpServerListeners = httpServer.listeners('request').slice(0);
  httpServer.removeAllListeners('request');
  httpServer.addListener('request', function (req, res) {

    var isExclude = req.url.indexOf('/healthcheck') === 0;

    if(isExclude){
      res.writeHead(200);
      res.end();
      return;
    }

    var target = httpsRedirectTarget(process.env.ROOT_URL, req.headers['x-forwarded-proto'], req.url);
    if (target) {
      res.writeHead(301, {'Location': target});
      res.end();
      return;
    }

    // connection is OK. Proceed normally.
    var args = arguments;
    _.each(oldHttpServerListeners, function(oldListener) {
      oldListener.apply(httpServer, args);
    });
  });
//}



// NOTE: this doesn't handle websockets!
//
// Websockets come in via the 'upgrade' request. We can override this,
// however the problem is we're not sure if the websocket is actually
// encrypted. We don't get x-forwarded-for or x-forwarded-proto on
// websockets. It's possible the 'sec-websocket-origin' header does
// what we want, but that's not clear.
//
// For now, this package allows raw unencrypted DDP connections over
// websockets.
