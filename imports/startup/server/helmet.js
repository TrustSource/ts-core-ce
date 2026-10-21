import {Meteor} from 'meteor/meteor';
import helmet from 'helmet';
import {WebApp} from 'meteor/webapp';

Meteor.startup(function () {
  (WebApp.handlers || WebApp.connectHandlers).use(helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: {
      policy: 'no-referrer'
    },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true
    },
    xFrameOptions: { action: 'deny' },
    xPermittedCrossDomainPolicies: {
      permittedPolicies: 'none'
    },
    contentSecurityPolicy : {
      useDefaults: true,
      directives: {
        defaultSrc: ['\'self\''],
         
        // NOTE: 'unsafe-inline' in script-src / script-src-attr is still required by
        // the Meteor boilerplate (__meteor_runtime_config__ is an inline <script>).
        // Removing it requires a CSP-nonce migration.
        // Until then, the compensating control against XSS *exfiltration* is the
        // connect-src allowlist below: even if an inline payload executes, it
        // cannot phone home to another origin. The self-hosted edition loads no
        // third-party scripts, images or media and calls no external API from the
        // browser, so every source is the app's own origin.
        scriptSrc: ['\'self\'', '\'unsafe-inline\''],
        scriptSrcAttr: ['\'unsafe-inline\''],
        connectSrc: ['\'self\''],                       // DDP websocket + same-origin XHR/fetch
        workerSrc: ['\'self\'', 'blob:'],
        imgSrc: ['\'self\'', 'data:'],
        styleSrc: ['\'self\'', '\'unsafe-inline\''],
        frameSrc: ['\'self\''],
        childSrc: ['\'self\'', 'blob:'],
        mediaSrc: ['\'self\'', 'data:', 'blob:']
      }
    }
  }))
});
