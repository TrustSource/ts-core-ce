/* global __meteor_runtime_config__:false */
import {Config} from '../../server/config';

// Tell the client whether self sign-up is on, so the login page hides its
// register link and /register redirects unless REGISTRATION_ENABLED=true. The
// server refuses the sign-up either way (forbidClientAccountCreation in
// accounts.js); this only keeps the UI from offering it.
if (!__meteor_runtime_config__.PUBLIC_SETTINGS) {
  __meteor_runtime_config__.PUBLIC_SETTINGS = {};
}
__meteor_runtime_config__.PUBLIC_SETTINGS.registrationEnabled = Config.REGISTRATION_ENABLED;
