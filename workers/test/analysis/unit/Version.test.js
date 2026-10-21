import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Version } from '../../../analysis/services/Version.js';
import { QOS } from '../../../analysis/services/QOS.js';

describe('Version', () => {
  describe('getLicenses', () => {
    it('returns version licenses when present', () => {
      const version = {
        licenses: [{ key: 'MIT', name: 'MIT License' }]
      };
      const result = Version.getLicenses(version, [], null, 'npm:test');
      assert.equal(result.length, 1);
      assert.equal(result[0].key, 'MIT');
      assert.equal(result[0].selected, true);
    });

    it('falls back to declaredLicenses when version has none', () => {
      const version = { licenses: [] };
      const declared = [{ key: 'Apache-2.0', name: 'Apache 2.0' }];
      const result = Version.getLicenses(version, declared, null, 'npm:test');
      assert.equal(result.length, 1);
      assert.equal(result[0].key, 'Apache-2.0');
    });

    it('auto-selects first license when none explicitly selected', () => {
      const version = {
        licenses: [{ key: 'MIT' }, { key: 'GPL-3.0' }]
      };
      const result = Version.getLicenses(version, [], null, 'npm:test');
      // sorted by key, first gets selected
      const selected = result.filter(l => l.selected);
      assert.equal(selected.length, 1);
    });

    it('filters out licenses without key or name', () => {
      const version = {
        licenses: [{ key: 'MIT' }, { notAKey: 'invalid' }]
      };
      const result = Version.getLicenses(version, [], null, 'npm:test');
      assert.equal(result.length, 1);
    });

    it('returns empty array when no licenses available', () => {
      const result = Version.getLicenses({ licenses: [] }, [], null, 'npm:test');
      assert.deepEqual(result, []);
    });
  });

  describe('findChecksum', () => {
    it('finds matching checksum', () => {
      const version = {
        checksums: [
          { checksum: 'sha1:abc123' },
          { checksum: 'md5:def456' }
        ]
      };
      const result = Version.findChecksum(version, 'sha1:abc123');
      assert.deepEqual(result, { checksum: 'sha1:abc123' });
    });

    it('returns undefined when no match', () => {
      const version = {
        checksums: [{ checksum: 'sha1:abc123' }]
      };
      assert.equal(Version.findChecksum(version, 'md5:xyz'), undefined);
    });

    it('returns undefined when no checksums or no algo', () => {
      assert.equal(Version.findChecksum({}, 'sha1:abc'), undefined);
      assert.equal(Version.findChecksum({ checksums: [] }, null), undefined);
    });
  });

  describe('validateChecksum', () => {
    it('returns valid=true for matching checksum with sufficient QOS', () => {
      const version = {
        checksums: [{ checksum: 'sha1:abc123', qos: QOS.REPO_CRAWLER }]
      };
      const result = Version.validateChecksum(version, 'sha1:abc123');
      assert.equal(result.valid, true);
      assert.equal(result.expected, 'sha1:abc123');
    });

    it('returns valid=false for mismatched checksum', () => {
      const version = {
        checksums: [{ checksum: 'sha1:abc123', qos: QOS.REPO_CRAWLER }]
      };
      const result = Version.validateChecksum(version, 'sha1:wrong');
      assert.equal(result.valid, false);
    });

    it('returns valid=null for insufficient QOS', () => {
      const version = {
        checksums: [{ checksum: 'sha1:abc123', qos: QOS.PACKAGE_META }]
      };
      const result = Version.validateChecksum(version, 'sha1:abc123');
      assert.equal(result.valid, null);
    });

    it('returns valid=null when no checksum found', () => {
      const result = Version.validateChecksum({}, 'sha1:abc123');
      assert.equal(result.valid, null);
    });
  });

  describe('getLicenses (real patterns)', () => {
    it('handles multi-license component with selected license override', () => {
      const version = {
        licenses: [
          { key: 'MIT', name: 'MIT License' },
          { key: 'Apache-2.0', name: 'Apache License 2.0' }
        ]
      };
      // selectedLicense forces a specific license to be selected
      const result = Version.getLicenses(version, [], 'Apache-2.0', 'npm:test');
      const selected = result.filter(l => l.selected);
      assert.equal(selected.length, 1);
      assert.equal(selected[0].key, 'Apache-2.0');
    });

    it('handles declaredLicenses fallback (real pattern: component with no version licenses)', () => {
      const version = {};
      const declared = [
        { key: 'BSD-3-Clause', name: 'BSD 3-Clause' },
        { key: 'MIT', name: 'MIT License' }
      ];
      const result = Version.getLicenses(version, declared, null, 'npm:test');
      assert.ok(result.length >= 1);
    });

    it('handles real sha-1 checksum format', () => {
      const version = {
        checksums: [
          { checksum: 'sha-1:e5fb58e6fc7b4ae1a9926d61f3d7a6c8b4e5d2f1', qos: QOS.REPO_CRAWLER }
        ]
      };
      const result = Version.findChecksum(version, 'sha-1:e5fb58e6fc7b4ae1a9926d61f3d7a6c8b4e5d2f1');
      assert.ok(result);
      assert.equal(result.checksum, 'sha-1:e5fb58e6fc7b4ae1a9926d61f3d7a6c8b4e5d2f1');
    });

    it('validates checksum with HUMAN qos level', () => {
      const version = {
        checksums: [{ checksum: 'sha-1:abc123', qos: QOS.HUMAN }]
      };
      const result = Version.validateChecksum(version, 'sha-1:abc123');
      assert.equal(result.valid, true);
    });
  });
});
