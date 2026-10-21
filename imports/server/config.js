/* global process:false */
import dotenv from 'dotenv';
import path from 'path';

if(process.env.NODE_ENV === 'development'){
  const currentDir = process.cwd();
  const result = dotenv.config({
    path: path.resolve(currentDir, '../../../../..', '.env')
  })
  if (result.error) {
    console.error('=> Failed to load .env file:', result.error);
  } else {
    console.log('=> Loaded .env file.');
  }
}

// Where the analysis and webhook worker code lives (workers/ in the repository). It is
// outside the Meteor bundle: the Docker image copies it to /opt/workers, and a
// development run (cwd .meteor/local/build/programs/server) uses the repository copy.
// An explicit TS_WORKERS_DIR is made absolute (against the server's working directory):
// Node refuses a relative Worker path that does not start with ./ or ../.
function resolveWorkersDir(env) {
  if (env.TS_WORKERS_DIR) {
    return path.resolve(env.TS_WORKERS_DIR);
  }
  return env.NODE_ENV === 'development'
    ? path.resolve(process.cwd(), '../../../../..', 'workers')
    : '/opt/workers';
}

function optionalText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function positiveInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return parsed > 0 ? parsed : fallback;
}

const conf = {
  DEBUG_MODE_ENABLED: (process.env.DEBUG_MODE_ENABLED && process.env.DEBUG_MODE_ENABLED === 'true') || false,

  TS_CHECK_SERVER: process.env.TS_CHECK_SERVER,
  MAIL_SENDER: process.env.MAIL_SENDER,
  MAIL_URL: process.env.MAIL_URL,
  METEOR_UPLOAD_FOLDER: process.env.METEOR_UPLOAD_FOLDER,
  MONGO_URI: process.env.MONGO_URI,
  PORT: process.env.PORT,
  ROOT_URL: process.env.ROOT_URL,
  // Optional operator details for outgoing mails (who runs this installation and
  // where to get help). Unset means the mails name only the app and its address.
  TS_OPERATOR_NAME: optionalText(process.env.TS_OPERATOR_NAME),
  TS_SUPPORT_EMAIL: optionalText(process.env.TS_SUPPORT_EMAIL),
  TS_IMPRINT_URL: optionalText(process.env.TS_IMPRINT_URL),
  // How many module analyses run at once, each in its own worker thread.
  TS_ANALYSIS_CONCURRENCY: positiveInteger(process.env.TS_ANALYSIS_CONCURRENCY, 2),
  TS_WORKERS_DIR: resolveWorkersDir(process.env),
  // EPSS (Exploit Prediction Scoring System) scores for the vulnerability
  // report's CVSS-vs-EPSS scatter plot, read straight from FIRST at
  // api.first.org. On unless set to the literal 'false' (air-gapped installs),
  // which plots every finding at the report's own floor instead.
  TS_EPSS_ENABLED: process.env.TS_EPSS_ENABLED !== 'false',
  // Vulnerability alerts. Parsed to a real boolean here, in the
  // `'true'`/`'false'` vocabulary DEBUG_MODE_ENABLED uses -
  // this was the only on/off-worded variable in the codebase.
  //
  // The sense is inverted relative to DEBUG_MODE_ENABLED because the default
  // differs: it is opt-IN (`=== 'true'`, default off), the sweep is opt-OUT, so only
  // the literal string `false` disables it. Anything else, including unset,
  // leaves it on.
  //
  // TS_VULN_ALERT_RELEASE_BATCH is a ROUND-ROBIN CURSOR, not a cap on coverage:
  // every approved release of an opted-in project is eventually evaluated, this
  // many per pass. Coverage latency = releases / batch x interval.
  TS_VULN_ALERT_SWEEP: process.env.TS_VULN_ALERT_SWEEP !== 'false',
  // Module analysis asks OSV (api.osv.dev) which vulnerabilities affect each component and
  // caches the answer. On unless set to the literal 'false' (air-gapped installs), which
  // leaves analysis with the cached data and manual vulnerabilities only.
  TS_OSV_ENABLED: process.env.TS_OSV_ENABLED !== 'false',
  TS_VULN_ALERT_INTERVAL_MIN: process.env.TS_VULN_ALERT_INTERVAL_MIN,
  TS_VULN_ALERT_PROJECT_BATCH: process.env.TS_VULN_ALERT_PROJECT_BATCH,
  TS_VULN_ALERT_RELEASE_BATCH: process.env.TS_VULN_ALERT_RELEASE_BATCH,
  // The CSAF provider this installation publishes advisories to. One installation
  // publishes to one provider; leaving these unset only makes publishing fail with
  // a message naming them (see imports/server/csaf/providerConfig.js).
  TS_CSAF_PROVIDER_URL: process.env.TS_CSAF_PROVIDER_URL,
  TS_CSAF_PROVIDER_PASSPHRASE: process.env.TS_CSAF_PROVIDER_PASSPHRASE,
  TS_CSAF_PROVIDER_PASSWORD: process.env.TS_CSAF_PROVIDER_PASSWORD,
  // Self sign-up with e-mail and password. Opt-IN: off unless the literal string
  // `true`. Invitations and the first admin seeded at startup are not affected.
  REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED === 'true',
  // First admin of a fresh installation (see imports/startup/server/initialAdmin.js).
  INITIAL_ADMIN_EMAIL: process.env.INITIAL_ADMIN_EMAIL,
  INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD,
  INITIAL_COMPANY_NAME: process.env.INITIAL_COMPANY_NAME
}

if(process.env.NODE_ENV !== 'development'){
  console.log('=> Config: ');
  Object.entries(conf).forEach(([key, value]) => {
    // A login credential: even the masked tail below would give away half of an
    // 8-character password, so only whether it is set is printed.
    if (key === 'INITIAL_ADMIN_PASSWORD') {
      console.log(`=> ${key} ${value ? 'set' : 'unset'}`);
      return;
    }
    let valueChanges = value
    if((key.indexOf('KEY') > -1 || key.indexOf('SECRET') > -1 || key.indexOf('MONGO_URI') > -1 ||
      key.indexOf('PASSWORD') > -1 || key.indexOf('PASSPHRASE') > -1 || key.indexOf('MAIL_URL') > -1)){
      let size = (key.indexOf('MAIL_URL') > -1 || key.indexOf('MONGO_URI') > -1) ? 8 : 4
      valueChanges = (valueChanges ? '****' + valueChanges.substr(valueChanges.length - size) : '')
    }
    console.log(`=> ${key} ${valueChanges}`);
  });
  const url = process.env.MAIL_URL;
  if(!url){
    console.log('=> MAIL_URL variable is missing');
  }
}

export const Config = conf;
