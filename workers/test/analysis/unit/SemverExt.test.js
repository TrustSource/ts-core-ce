import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SemverExt } from '../../../analysis/services/SemverExt.js';

describe('SemverExt', () => {
  describe('compare', () => {
    it('returns 0 for equal versions', () => {
      assert.equal(SemverExt.compare('1.0.0', '1.0.0', true), 0);
    });

    it('returns 1 when a > b', () => {
      assert.equal(SemverExt.compare('2.0.0', '1.0.0', true), 1);
    });

    it('returns -1 when a < b', () => {
      assert.equal(SemverExt.compare('1.0.0', '2.0.0', true), -1);
    });

    it('handles partial versions in lenient mode', () => {
      assert.equal(SemverExt.compare('1.0', '1.0.0', true), 0);
      assert.equal(SemverExt.compare('2', '1.0.0', true), 1);
    });

    it('compares non-semver strings lexicographically', () => {
      assert.equal(SemverExt.compare('abc', 'def', true), -1);
      assert.equal(SemverExt.compare('def', 'abc', true), 1);
      assert.equal(SemverExt.compare('abc', 'abc', true), 0);
    });

    it('valid semver sorts after non-semver', () => {
      assert.equal(SemverExt.compare('1.0.0', 'abc', true), 1);
      assert.equal(SemverExt.compare('abc', '1.0.0', true), -1);
    });
  });

  describe('arraySortByVersion', () => {
    it('sorts objects by version property ascending', () => {
      const input = [
        { version: '2.0.0' },
        { version: '1.0.0' },
        { version: '3.0.0' }
      ];
      const result = SemverExt.arraySortByVersion(input);
      assert.deepEqual(result.map(v => v.version), ['1.0.0', '2.0.0', '3.0.0']);
    });

    it('handles mixed valid/invalid versions', () => {
      const input = [
        { version: '2.0.0' },
        { version: 'alpha' },
        { version: '1.0.0' }
      ];
      const result = SemverExt.arraySortByVersion(input);
      assert.equal(result[result.length - 1].version, '2.0.0');
    });

    it('returns non-array input as-is', () => {
      assert.equal(SemverExt.arraySortByVersion(null), null);
      assert.equal(SemverExt.arraySortByVersion(undefined), undefined);
    });

    it('uses custom property name', () => {
      const input = [
        { ver: '2.0.0' },
        { ver: '1.0.0' }
      ];
      const result = SemverExt.arraySortByVersion(input, 'ver');
      assert.deepEqual(result.map(v => v.ver), ['1.0.0', '2.0.0']);
    });
  });
});
