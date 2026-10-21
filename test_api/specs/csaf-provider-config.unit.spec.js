/* eslint-disable no-undef */
// CSAF provider credentials move from AWS SSM to environment variables.
//
// WHAT THIS COVERS. imports/server/csaf/providerConfig.js - plain CommonJS with no
// Meteor import, so Jest can require it directly (the same shape as
// imports/server/csaf/productIdCodec.js). It is the whole contract between the
// operator's environment and tsCsafUpload: which variables are missing, and what
// the base URL looks like once normalised.
//
// The publish button stays enabled when nothing is configured, so the message
// produced from providerConfigErrors() is the only thing a CE operator sees when
// publishing fails. Its wording is therefore asserted, not just its length.
const {
  PROVIDER_ENV_VARS,
  providerConfigErrors,
  resolveProviderConfig
} = require('../../imports/server/csaf/providerConfig');

const COMPLETE = {
  TS_CSAF_PROVIDER_URL: 'https://csaf.example.com/',
  TS_CSAF_PROVIDER_PASSPHRASE: 'open-sesame',
  TS_CSAF_PROVIDER_PASSWORD: 's3cret'
};

describe('csaf providerConfig', () => {
  describe('PROVIDER_ENV_VARS', () => {
    it('names the three variables an operator has to set', () => {
      expect(PROVIDER_ENV_VARS).toEqual([
        'TS_CSAF_PROVIDER_URL',
        'TS_CSAF_PROVIDER_PASSPHRASE',
        'TS_CSAF_PROVIDER_PASSWORD'
      ]);
    });
  });

  describe('providerConfigErrors', () => {
    it('reports every variable by name when nothing is configured', () => {
      const errors = providerConfigErrors({});
      expect(errors).toEqual([
        'TS_CSAF_PROVIDER_URL is not set',
        'TS_CSAF_PROVIDER_PASSPHRASE is not set',
        'TS_CSAF_PROVIDER_PASSWORD is not set'
      ]);
    });

    it('reports only the variable that is still missing', () => {
      const env = Object.assign({}, COMPLETE);
      delete env.TS_CSAF_PROVIDER_PASSPHRASE;
      expect(providerConfigErrors(env)).toEqual(['TS_CSAF_PROVIDER_PASSPHRASE is not set']);
    });

    it('treats a blank value as not set', () => {
      const env = Object.assign({}, COMPLETE, {TS_CSAF_PROVIDER_PASSWORD: '   '});
      expect(providerConfigErrors(env)).toEqual(['TS_CSAF_PROVIDER_PASSWORD is not set']);
    });

    it('rejects a URL without an http scheme', () => {
      const env = Object.assign({}, COMPLETE, {TS_CSAF_PROVIDER_URL: 'csaf.example.com'});
      expect(providerConfigErrors(env)).toEqual([
        'TS_CSAF_PROVIDER_URL must start with http:// or https://'
      ]);
    });

    it('accepts a plain http URL', () => {
      const env = Object.assign({}, COMPLETE, {TS_CSAF_PROVIDER_URL: 'http://localhost:8080'});
      expect(providerConfigErrors(env)).toEqual([]);
    });

    it('returns nothing when all three are set', () => {
      expect(providerConfigErrors(COMPLETE)).toEqual([]);
    });
  });

  describe('resolveProviderConfig', () => {
    it('returns the passphrase and password unchanged', () => {
      const config = resolveProviderConfig(COMPLETE);
      expect(config.passphrase).toBe('open-sesame');
      expect(config.password).toBe('s3cret');
    });

    it('appends the trailing slash the upload and self URLs are built on', () => {
      const env = Object.assign({}, COMPLETE, {TS_CSAF_PROVIDER_URL: 'https://csaf.example.com'});
      expect(resolveProviderConfig(env).baseUrl).toBe('https://csaf.example.com/');
    });

    it('collapses repeated trailing slashes to one', () => {
      const env = Object.assign({}, COMPLETE, {TS_CSAF_PROVIDER_URL: 'https://csaf.example.com///'});
      expect(resolveProviderConfig(env).baseUrl).toBe('https://csaf.example.com/');
    });

    it('trims surrounding whitespace off the URL', () => {
      const env = Object.assign({}, COMPLETE, {TS_CSAF_PROVIDER_URL: '  https://csaf.example.com/  '});
      expect(resolveProviderConfig(env).baseUrl).toBe('https://csaf.example.com/');
    });

    it('keeps a path prefix so the provider can live under a sub-path', () => {
      const env = Object.assign({}, COMPLETE, {TS_CSAF_PROVIDER_URL: 'https://example.com/csaf'});
      expect(resolveProviderConfig(env).baseUrl).toBe('https://example.com/csaf/');
    });
  });
});
