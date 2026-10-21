import {Meteor} from 'meteor/meteor';

// Startup guardrail for the at-rest encryption key (see imports/lib/crypto.js).
// There is no built-in key: without TS_ENCRYPTION_KEY the app falls back to
// TS_ENCRYPTION_KEY_LEGACY (the pre-rotation password), and with neither it can
// neither read nor write stored credentials, API-key lookups or signatures.
// A production server in that state refuses to start; one running on the
// legacy password only is flagged, and can be refused with
// TS_REQUIRE_ENCRYPTION_KEY=true.
Meteor.startup(function () {
  if (process.env.TS_ENCRYPTION_KEY) {
    return;
  }
  const banner = '='.repeat(72);
  if (!process.env.TS_ENCRYPTION_KEY_LEGACY) {
    const msg = 'Neither TS_ENCRYPTION_KEY nor TS_ENCRYPTION_KEY_LEGACY is set - stored ' +
      'credentials, REST API keys and signatures can be neither read nor written. Set ' +
      'TS_ENCRYPTION_KEY.';
    if (Meteor.isProduction) {
      console.error(`\n${banner}\n[SECURITY] ${msg}\n${banner}\n`);
      console.error('[SECURITY] refusing to start without an encryption key.');
      process.exit(1);
    } else {
      console.error(`[crypto] ${msg}`);
    }
    return;
  }
  const msg = 'TS_ENCRYPTION_KEY is not set - stored integration credentials are ' +
    'encrypted with TS_ENCRYPTION_KEY_LEGACY, the pre-rotation password. Set ' +
    'TS_ENCRYPTION_KEY to a strong random secret.';
  if (Meteor.isProduction) {
    console.error(`\n${banner}\n[SECURITY] ${msg}\n${banner}\n`);
    if (process.env.TS_REQUIRE_ENCRYPTION_KEY === 'true') {
      console.error('[SECURITY] TS_REQUIRE_ENCRYPTION_KEY=true - refusing to start without TS_ENCRYPTION_KEY.');
      process.exit(1);
    }
  } else {
    console.warn(`[crypto] ${msg}`);
  }
});
