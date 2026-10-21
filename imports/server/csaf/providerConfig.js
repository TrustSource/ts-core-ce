// The CSAF provider a Community Edition installation publishes to.
//
// One installation publishes to one provider, so all three values come from the
// environment. There is no per-company lookup: the hosted build derived the
// provider host from each document's `providerId` and read the two credentials
// out of a managed parameter store, neither of which a self-hosted installation
// has any way to serve.
//
// Plain CommonJS with no Meteor import on purpose - Jest requires this file
// directly (test_api/specs/csaf-provider-config.unit.spec.js), and the caller
// turns `providerConfigErrors()` into the Meteor.Error the browser shows.
const PROVIDER_ENV_VARS = [
  'TS_CSAF_PROVIDER_URL',
  'TS_CSAF_PROVIDER_PASSPHRASE',
  'TS_CSAF_PROVIDER_PASSWORD'
];

function read(env, name) {
  const value = env && env[name];
  return typeof value === 'string' ? value.trim() : '';
}

// Every reason the environment cannot publish, one per line, each naming the
// variable to set. The publish button stays enabled when nothing is configured,
// so this list is the only guidance an operator gets.
function providerConfigErrors(env) {
  const errors = [];
  PROVIDER_ENV_VARS.forEach(function (name) {
    if (!read(env, name)) {
      errors.push(`${name} is not set`);
    }
  });
  const url = read(env, 'TS_CSAF_PROVIDER_URL');
  if (url && !/^https?:\/\//i.test(url)) {
    errors.push('TS_CSAF_PROVIDER_URL must start with http:// or https://');
  }
  return errors;
}

// `baseUrl` always ends in exactly one slash: both the upload endpoint
// (`<base>cgi-bin/provider/api/upload`) and the canonical self reference
// (`<base>.well-known/csaf/...`) are appended to it directly.
function withSingleTrailingSlash(url) {
  // A loop rather than /\/+$/ - a repetition anchored at the end backtracks.
  let trimmed = url;
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed + '/';
}

function resolveProviderConfig(env) {
  return {
    baseUrl: withSingleTrailingSlash(read(env, 'TS_CSAF_PROVIDER_URL')),
    passphrase: read(env, 'TS_CSAF_PROVIDER_PASSPHRASE'),
    password: read(env, 'TS_CSAF_PROVIDER_PASSWORD')
  };
}

module.exports = {PROVIDER_ENV_VARS, providerConfigErrors, resolveProviderConfig};
