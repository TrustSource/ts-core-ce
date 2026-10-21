import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pairId, purlBase, osvPackage, buildQueries, KEY_MAX } from '../../../analysis/services/osv/queries.js';

function comp(key, ...versions) {
  return { key, versions: versions.map(version => ({ version })) };
}

describe('osv queries', () => {
  describe('pairId', () => {
    it('matches the id ts-app computes for the same pair', () => {
      // The same literal is pinned in test_api/specs/osv-lake-service.unit.spec.js.
      assert.equal(pairId('npm:lodash', '4.17.20'), 'osv:d6a639ca32547f2e7cf09432475102d4b814580f');
    });

    it('keeps key and version apart', () => {
      assert.notEqual(pairId('npm:a:1', '2'), pairId('npm:a', '1:2'));
    });
  });

  describe('purlBase', () => {
    it('drops version, qualifiers and subpath', () => {
      assert.equal(purlBase('pkg:npm/lodash@4.17.20?foo=bar#sub'), 'pkg:npm/lodash');
      assert.equal(purlBase('pkg:npm/%40babel/core@7.0.0'), 'pkg:npm/%40babel/core');
      assert.equal(purlBase('pkg:golang/github.com/Masterminds/semver/v3@v3.1.0'),
        'pkg:golang/github.com/Masterminds/semver/v3');
    });

    it('refuses purl types OSV does not resolve and malformed values', () => {
      assert.equal(purlBase('pkg:generic/foo@1.0'), null);
      assert.equal(purlBase('pkg:npm'), null);
      assert.equal(purlBase('pkg:npm/'), null);
      assert.equal(purlBase('npm:lodash'), null);
      assert.equal(purlBase(undefined), null);
    });

    it('refuses a purl with a segment that cannot be percent-decoded', () => {
      // OSV answers HTTP 400 for the whole querybatch when one purl has a bad escape.
      assert.equal(purlBase('pkg:npm/bad%zzname@1.0.0'), null);
    });
  });

  describe('osvPackage', () => {
    it('prefers the scan purl, which keeps the original case', () => {
      assert.deepEqual(
        osvPackage('golang:github.com/masterminds:semver', 'pkg:golang/github.com/Masterminds/semver@v1.5.0'),
        { purl: 'pkg:golang/github.com/Masterminds/semver' });
    });

    it('maps key prefixes to OSV ecosystems', () => {
      assert.deepEqual(osvPackage('npm:lodash'), { ecosystem: 'npm', name: 'lodash' });
      assert.deepEqual(osvPackage('npm:@babel:core'), { ecosystem: 'npm', name: '@babel/core' });
      assert.deepEqual(osvPackage('maven:org.apache.logging.log4j:log4j-core'),
        { ecosystem: 'Maven', name: 'org.apache.logging.log4j:log4j-core' });
      assert.deepEqual(osvPackage('mvn:org.slf4j:slf4j-api'), { ecosystem: 'Maven', name: 'org.slf4j:slf4j-api' });
      assert.deepEqual(osvPackage('pypi:requests'), { ecosystem: 'PyPI', name: 'requests' });
      assert.deepEqual(osvPackage('cargo:serde'), { ecosystem: 'crates.io', name: 'serde' });
      assert.deepEqual(osvPackage('composer:symfony:http-kernel'), { ecosystem: 'Packagist', name: 'symfony/http-kernel' });
      assert.deepEqual(osvPackage('golang:github.com/foo:bar'), { ecosystem: 'Go', name: 'github.com/foo/bar' });
      assert.deepEqual(osvPackage('gem:rails'), { ecosystem: 'RubyGems', name: 'rails' });
      assert.deepEqual(osvPackage('nuget:newtonsoft.json'), { ecosystem: 'NuGet', name: 'newtonsoft.json' });
      assert.deepEqual(osvPackage('pub:http'), { ecosystem: 'Pub', name: 'http' });
    });

    it('answers null for keys OSV has no ecosystem or no usable name for', () => {
      assert.equal(osvPackage('im:internal-lib'), null);
      assert.equal(osvPackage('apk:alpine:busybox'), null);
      assert.equal(osvPackage('maven:no-group'), null);
      assert.equal(osvPackage('npm:'), null);
      assert.equal(osvPackage('lodash'), null);
      assert.equal(osvPackage(undefined), null);
    });

    it('falls back to the key when the scan purl is of a type OSV does not resolve', () => {
      assert.deepEqual(osvPackage('npm:lodash', 'pkg:generic/lodash@1.0.0'), { ecosystem: 'npm', name: 'lodash' });
    });

    it('ignores a scan purl that names another package than the key', () => {
      assert.deepEqual(osvPackage('npm:lodash', 'pkg:npm/left-pad@1.3.0'), { ecosystem: 'npm', name: 'lodash' });
    });

    it('uses the scan purl when it names the key package, whatever the case or percent-encoding', () => {
      assert.deepEqual(
        osvPackage('golang:github.com/masterminds:semver', 'pkg:golang/github.com/Masterminds/semver@v1.5.0'),
        { purl: 'pkg:golang/github.com/Masterminds/semver' });
      assert.deepEqual(osvPackage('npm:@babel:core', 'pkg:npm/%40babel/core@7.0.0'), { purl: 'pkg:npm/%40babel/core' });
      assert.deepEqual(osvPackage('maven:org.slf4j:slf4j-api', 'pkg:maven/org.slf4j/slf4j-api@1.7.36'),
        { purl: 'pkg:maven/org.slf4j/slf4j-api' });
      assert.deepEqual(osvPackage('mvn:org.slf4j:slf4j-api', 'pkg:maven/org.slf4j/slf4j-api@1.7.36'),
        { purl: 'pkg:maven/org.slf4j/slf4j-api' });
    });

    it('falls back to the key when the scan purl cannot be percent-decoded', () => {
      assert.deepEqual(osvPackage('npm:badname', 'pkg:npm/bad%zzname@1.0.0'), { ecosystem: 'npm', name: 'badname' });
    });
  });

  describe('buildQueries', () => {
    it('makes one query per distinct pair, with the scan purl when known', () => {
      const components = {
        'npm:lodash': comp('npm:lodash', '4.17.20', '4.17.21', '4.17.20'),
        'pypi:requests': comp('pypi:requests', '2.0.0')
      };
      const purls = new Map([[pairId('npm:lodash', '4.17.20'), 'pkg:npm/lodash@4.17.20']]);

      const queries = buildQueries(components, purls, () => false);

      assert.deepEqual(queries.map(q => [q.key, q.version, q.package]), [
        ['npm:lodash', '4.17.20', { purl: 'pkg:npm/lodash' }],
        ['npm:lodash', '4.17.21', { ecosystem: 'npm', name: 'lodash' }],
        ['pypi:requests', '2.0.0', { ecosystem: 'PyPI', name: 'requests' }]
      ]);
      assert.equal(queries[0].id, pairId('npm:lodash', '4.17.20'));
    });

    it('skips whitelisted components, placeholder and oversized versions, long keys and unknown ecosystems', () => {
      const components = {
        a: comp('npm:allowed', '1.0.0'),
        b: comp('npm:listed', '1.0.0'),
        c: comp('npm:placeholder', '0.0.0', ''),
        d: comp('npm:big', 'x'.repeat(201)),
        e: comp('npm:' + 'k'.repeat(KEY_MAX), '1.0.0'),
        f: comp('im:internal', '1.0.0')
      };
      const asked = [];

      const queries = buildQueries(components, new Map(), (key, versions) => {
        asked.push([key, versions]);
        return key === 'npm:listed';
      });

      assert.deepEqual(queries.map(q => q.key), ['npm:allowed']);
      assert.deepEqual(asked.find(entry => entry[0] === 'npm:listed'), ['npm:listed', ['1.0.0']]);
    });

    it('asks about the key package when the scan purl names another one', () => {
      const components = { 'npm:lodash': comp('npm:lodash', '4.17.20') };
      const purls = new Map([[pairId('npm:lodash', '4.17.20'), 'pkg:npm/left-pad@1.3.0']]);

      const queries = buildQueries(components, purls, () => false);

      assert.deepEqual(queries.map(q => [q.id, q.package]), [
        [pairId('npm:lodash', '4.17.20'), { ecosystem: 'npm', name: 'lodash' }]
      ]);
    });

    it('answers no queries for no components', () => {
      assert.deepEqual(buildQueries(undefined, new Map(), () => false), []);
    });
  });
});
