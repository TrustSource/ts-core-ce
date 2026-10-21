import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Statistics } from '../../../analysis/services/Statistics.js';
import { Analysis } from '../../../analysis/services/ModuleAnalyzer.js';

// Minimal stats with all categories at zero - matches Analysis constructor shape
function makeFullStats(overrides = {}) {
  return {
    licenses: 0,
    components: 0,
    legal: { warnings: 0, violations: 0 },
    vulnerability: { warnings: 0, violations: 0 },
    viability: { warnings: 0, violations: 0 },
    versioning: { warnings: 0, violations: 0 },
    encryption: { warnings: 0, violations: 0 },
    ossf: { warnings: 0, violations: 0 },
    integrity: { warnings: 0, violations: 0 },
    'multy-legal': { warnings: 0, violations: 0 },
    endoflife: { warnings: 0, violations: 0 },
    overall: { warnings: 0, violations: 0 },
    ...overrides
  };
}

// Minimal stats with only the 4 categories getSummary uses
function makeStats(overrides = {}) {
  return {
    components: 10,
    licenses: 5,
    legal: { warnings: 0, violations: 0 },
    vulnerability: { warnings: 0, violations: 0 },
    viability: { warnings: 0, violations: 0 },
    integrity: { warnings: 0, violations: 0 },
    ...overrides
  };
}

describe('Statistics', () => {
  describe('getSummary', () => {
    it('returns zeros for clean stats', () => {
      const summary = Statistics.getSummary(makeStats());
      assert.equal(summary.warnings, 0);
      assert.equal(summary.violations, 0);
      assert.equal(summary.components, 10);
      assert.equal(summary.licenses, 5);
    });

    it('sums warnings from legal + vulnerability + viability + integrity', () => {
      const stats = makeStats({
        legal: { warnings: 2, violations: 0 },
        vulnerability: { warnings: 3, violations: 0 },
        viability: { warnings: 1, violations: 0 },
        integrity: { warnings: 4, violations: 0 }
      });
      const summary = Statistics.getSummary(stats);
      assert.equal(summary.warnings, 10); // 2+3+1+4
    });

    it('sums violations from legal + vulnerability + viability + integrity', () => {
      const stats = makeStats({
        legal: { warnings: 0, violations: 5 },
        vulnerability: { warnings: 0, violations: 3 },
        viability: { warnings: 0, violations: 2 },
        integrity: { warnings: 1, violations: 7 }
      });
      const summary = Statistics.getSummary(stats);
      assert.equal(summary.violations, 17); // 5+3+2+7
    });

    it('does NOT include versioning, encryption, ossf, endoflife in summary', () => {
      const stats = makeStats({
        versioning: { warnings: 100, violations: 100 },
        encryption: { warnings: 100, violations: 100 },
        ossf: { warnings: 100, violations: 100 },
        endoflife: { warnings: 100, violations: 100 }
      });
      const summary = Statistics.getSummary(stats);
      assert.equal(summary.warnings, 0);
      assert.equal(summary.violations, 0);
    });
  });

  describe('getState', () => {
    it('returns ok for clean stats', () => {
      assert.equal(Statistics.getState(makeStats()), 'ok');
    });

    it('returns warnings for legal warnings only', () => {
      assert.equal(Statistics.getState(makeStats({ legal: { warnings: 1, violations: 0 } })), 'warnings');
    });

    it('returns warnings for vulnerability warnings only', () => {
      assert.equal(Statistics.getState(makeStats({ vulnerability: { warnings: 1, violations: 0 } })), 'warnings');
    });

    it('returns warnings for viability warnings only', () => {
      assert.equal(Statistics.getState(makeStats({ viability: { warnings: 1, violations: 0 } })), 'warnings');
    });

    it('returns warnings for integrity warnings only', () => {
      assert.equal(Statistics.getState(makeStats({ integrity: { warnings: 1, violations: 0 } })), 'warnings');
    });

    it('returns violations for legal violations', () => {
      assert.equal(Statistics.getState(makeStats({ legal: { warnings: 0, violations: 1 } })), 'violations');
    });

    it('returns violations for vulnerability violations', () => {
      assert.equal(Statistics.getState(makeStats({ vulnerability: { warnings: 0, violations: 1 } })), 'violations');
    });

    it('returns violations for viability violations', () => {
      assert.equal(Statistics.getState(makeStats({ viability: { warnings: 0, violations: 1 } })), 'violations');
    });

    it('violations takes precedence over warnings', () => {
      const stats = makeStats({
        legal: { warnings: 10, violations: 1 },
        vulnerability: { warnings: 5, violations: 0 }
      });
      assert.equal(Statistics.getState(stats), 'violations');
    });

    it('versioning/encryption/ossf/endoflife alone do NOT change state', () => {
      const stats = makeStats({
        versioning: { warnings: 50, violations: 50 },
        encryption: { warnings: 50, violations: 50 },
        ossf: { warnings: 50, violations: 50 },
        endoflife: { warnings: 50, violations: 50 }
      });
      assert.equal(Statistics.getState(stats), 'ok');
    });
  });

  describe('addComponentError → statistics integration', () => {
    let analysis;

    beforeEach(() => {
      analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:test'] = {
        key: 'npm:test', versions: [{ version: '1.0.0' }], status: 'ok'
      };
    });

    it('legal warning increments statistics.legal.warnings', () => {
      analysis.addComponentError('legal', 'warnings', 'unknown license', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.legal.warnings, 1);
      assert.equal(analysis.statistics.legal.violations, 0);
    });

    it('legal violation increments statistics.legal.violations', () => {
      analysis.addComponentError('legal', 'violations', 'blacklisted', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.legal.violations, 1);
      assert.equal(analysis.statistics.legal.warnings, 0);
    });

    it('vulnerability warning increments statistics.vulnerability.warnings', () => {
      analysis.addComponentError('vulnerability', 'warnings', 'CVE-2021-1234', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.vulnerability.warnings, 1);
      assert.equal(analysis.statistics.vulnerability.violations, 0);
    });

    it('vulnerability violation increments statistics.vulnerability.violations', () => {
      analysis.addComponentError('vulnerability', 'violations', 'CVE-2021-CRIT', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.vulnerability.violations, 1);
    });

    it('viability warning increments statistics.viability.warnings', () => {
      analysis.addComponentError('viability', 'warnings', 'low stars', 'npm:test');
      assert.equal(analysis.statistics.viability.warnings, 1);
    });

    it('viability violation increments statistics.viability.violations', () => {
      analysis.addComponentError('viability', 'violations', 'no info', 'npm:test');
      assert.equal(analysis.statistics.viability.violations, 1);
    });

    it('versioning warning increments statistics.versioning.warnings', () => {
      analysis.addComponentError('versioning', 'warnings', 'outdated', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.versioning.warnings, 1);
    });

    it('versioning violation increments statistics.versioning.violations', () => {
      analysis.addComponentError('versioning', 'violations', 'major gap', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.versioning.violations, 1);
    });

    it('encryption warning increments statistics.encryption.warnings', () => {
      analysis.addComponentError('encryption', 'warnings', 'weak export', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.encryption.warnings, 1);
    });

    it('encryption violation increments statistics.encryption.violations', () => {
      analysis.addComponentError('encryption', 'violations', 'strict export', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.encryption.violations, 1);
    });

    it('ossf warning increments statistics.ossf.warnings', () => {
      analysis.addComponentError('ossf', 'warnings', 'low score', 'npm:test');
      assert.equal(analysis.statistics.ossf.warnings, 1);
    });

    it('ossf violation increments statistics.ossf.violations', () => {
      analysis.addComponentError('ossf', 'violations', 'very low score', 'npm:test');
      assert.equal(analysis.statistics.ossf.violations, 1);
    });

    it('endoflife warning increments statistics.endoflife.warnings', () => {
      analysis.addComponentError('endoflife', 'warnings', 'approaching EOL', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.endoflife.warnings, 1);
    });

    it('endoflife violation increments statistics.endoflife.violations', () => {
      analysis.addComponentError('endoflife', 'violations', 'past EOL', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.endoflife.violations, 1);
    });

    it('integrity violation increments statistics.integrity.violations', () => {
      analysis.addComponentError('integrity', 'violations', 'checksum mismatch', 'npm:test', '1.0.0');
      assert.equal(analysis.statistics.integrity.violations, 1);
    });

    it('multiple findings across categories accumulate correctly', () => {
      analysis.addComponentError('legal', 'warnings', 'unknown', 'npm:test', '1.0.0');
      analysis.addComponentError('legal', 'warnings', 'unmatched', 'npm:test', '1.0.0');
      analysis.addComponentError('legal', 'violations', 'blacklisted', 'npm:test', '1.0.0');
      analysis.addComponentError('vulnerability', 'violations', 'CVE-HIGH', 'npm:test', '1.0.0');
      analysis.addComponentError('vulnerability', 'warnings', 'CVE-MED', 'npm:test', '1.0.0');
      analysis.addComponentError('versioning', 'warnings', 'outdated', 'npm:test', '1.0.0');
      analysis.addComponentError('encryption', 'violations', 'strict', 'npm:test', '1.0.0');

      assert.equal(analysis.statistics.legal.warnings, 2);
      assert.equal(analysis.statistics.legal.violations, 1);
      assert.equal(analysis.statistics.vulnerability.warnings, 1);
      assert.equal(analysis.statistics.vulnerability.violations, 1);
      assert.equal(analysis.statistics.versioning.warnings, 1);
      assert.equal(analysis.statistics.encryption.violations, 1);

      // getSummary only considers legal + vulnerability + viability + integrity
      const summary = Statistics.getSummary(analysis.statistics);
      assert.equal(summary.warnings, 3);  // legal(2) + vuln(1)
      assert.equal(summary.violations, 2); // legal(1) + vuln(1)
      assert.equal(Statistics.getState(analysis.statistics), 'violations');
    });

    it('notCount=true adds problem but does NOT increment stats', () => {
      analysis.addComponentError('legal', 'warnings', 'info only', 'npm:test', '1.0.0', null, true);
      assert.equal(analysis.statistics.legal.warnings, 0);
      assert.equal(analysis.components['npm:test'].problems.legal.length, 1);
    });

    it('problems are attached to the correct component', () => {
      analysis.components['npm:other'] = {
        key: 'npm:other', versions: [{ version: '2.0.0' }], status: 'ok'
      };

      analysis.addComponentError('vulnerability', 'violations', 'CVE-1', 'npm:test', '1.0.0');
      analysis.addComponentError('legal', 'warnings', 'unknown', 'npm:other', '2.0.0');

      assert.equal(analysis.components['npm:test'].problems.vulnerability.length, 1);
      assert.equal(analysis.components['npm:test'].problems.legal, undefined);
      assert.equal(analysis.components['npm:other'].problems.legal.length, 1);
      assert.equal(analysis.components['npm:other'].problems.vulnerability, undefined);
    });

    it('silently does nothing when component key not found', () => {
      analysis.addComponentError('legal', 'warnings', 'unknown', 'npm:nonexistent', '1.0.0');
      assert.equal(analysis.statistics.legal.warnings, 0);
    });

    it('throws for invalid category', () => {
      assert.throws(() => {
        analysis.addComponentError('invalid_cat', 'warnings', 'msg', 'npm:test');
      });
    });

    it('throws for invalid status', () => {
      assert.throws(() => {
        analysis.addComponentError('legal', 'invalid_status', 'msg', 'npm:test');
      });
    });

    it('throws for missing message', () => {
      assert.throws(() => {
        analysis.addComponentError('legal', 'warnings', '', 'npm:test');
      });
    });

    it('extra data is stored in problem', () => {
      const extra = { latest: '5.0.0' };
      analysis.addComponentError('versioning', 'warnings', 'outdated', 'npm:test', '1.0.0', extra);
      assert.deepEqual(analysis.components['npm:test'].problems.versioning[0].extra, { latest: '5.0.0' });
    });

    it('component.status is updated to warnings on warning', () => {
      analysis.addComponentError('legal', 'warnings', 'unknown', 'npm:test', '1.0.0');
      assert.equal(analysis.components['npm:test'].status, 'warnings');
    });

    it('component.status is updated to violations on violation', () => {
      analysis.addComponentError('vulnerability', 'violations', 'CVE-CRIT', 'npm:test', '1.0.0');
      assert.equal(analysis.components['npm:test'].status, 'violations');
    });
  });

  describe('end-to-end: findings → statistics → getSummary → getState', () => {
    it('legal-only findings → state is warnings', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('legal', 'warnings', 'unmatched license', 'npm:a', '1.0.0');

      const state = Statistics.getState(analysis.statistics);
      assert.equal(state, 'warnings');
      const summary = Statistics.getSummary(analysis.statistics);
      assert.equal(summary.warnings, 1);
      assert.equal(summary.violations, 0);
    });

    it('vulnerability violation → state is violations', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('vulnerability', 'violations', 'CVE-2023-9999 (score 9.8)', 'npm:a', '1.0.0');

      assert.equal(Statistics.getState(analysis.statistics), 'violations');
    });

    it('viability violation → state is violations', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('viability', 'violations', 'no info', 'npm:a');

      assert.equal(Statistics.getState(analysis.statistics), 'violations');
    });

    it('integrity warning → state is warnings (not violations)', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('integrity', 'warnings', 'weak checksum', 'npm:a', '1.0.0');

      const summary = Statistics.getSummary(analysis.statistics);
      assert.equal(summary.warnings, 1);
      assert.equal(summary.violations, 0);
      assert.equal(Statistics.getState(analysis.statistics), 'warnings');
    });

    it('integrity violation → state is violations', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('integrity', 'violations', 'checksum mismatch', 'npm:a', '1.0.0');

      const summary = Statistics.getSummary(analysis.statistics);
      assert.equal(summary.warnings, 0);
      assert.equal(summary.violations, 1);
      assert.equal(Statistics.getState(analysis.statistics), 'violations');
    });

    it('versioning-only findings do NOT affect overall state', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('versioning', 'violations', 'major gap', 'npm:a', '1.0.0');
      analysis.addComponentError('versioning', 'warnings', 'minor gap', 'npm:a', '1.0.0');

      assert.equal(analysis.statistics.versioning.violations, 1);
      assert.equal(analysis.statistics.versioning.warnings, 1);
      // But summary/state ignores versioning
      assert.equal(Statistics.getState(analysis.statistics), 'ok');
    });

    it('encryption-only findings do NOT affect overall state', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('encryption', 'violations', 'strict export', 'npm:a', '1.0.0');

      assert.equal(analysis.statistics.encryption.violations, 1);
      assert.equal(Statistics.getState(analysis.statistics), 'ok');
    });

    it('ossf-only findings do NOT affect overall state', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('ossf', 'violations', 'very low', 'npm:a');

      assert.equal(analysis.statistics.ossf.violations, 1);
      assert.equal(Statistics.getState(analysis.statistics), 'ok');
    });

    it('endoflife-only findings do NOT affect overall state', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      analysis.addComponentError('endoflife', 'violations', 'past EOL', 'npm:a', '1.0.0');

      assert.equal(analysis.statistics.endoflife.violations, 1);
      assert.equal(Statistics.getState(analysis.statistics), 'ok');
    });

    it('mixed core + non-core findings: only core categories affect state', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };

      // Non-core: should not affect state
      analysis.addComponentError('versioning', 'violations', 'gap', 'npm:a', '1.0.0');
      analysis.addComponentError('encryption', 'violations', 'strict', 'npm:a', '1.0.0');
      analysis.addComponentError('ossf', 'violations', 'low', 'npm:a');
      analysis.addComponentError('endoflife', 'violations', 'eol', 'npm:a', '1.0.0');

      assert.equal(Statistics.getState(analysis.statistics), 'ok');

      // Now add a core warning → state changes
      analysis.addComponentError('legal', 'warnings', 'unknown', 'npm:a', '1.0.0');
      assert.equal(Statistics.getState(analysis.statistics), 'warnings');

      // Add a core violation → state escalates
      analysis.addComponentError('vulnerability', 'violations', 'CVE-HIGH', 'npm:a', '1.0.0');
      assert.equal(Statistics.getState(analysis.statistics), 'violations');
    });

    it('multiple components each contributing findings', () => {
      const analysis = new Analysis('C1', 'M1', false, null);
      analysis.components['npm:a'] = { key: 'npm:a', versions: [{ version: '1.0.0' }], status: 'ok' };
      analysis.components['npm:b'] = { key: 'npm:b', versions: [{ version: '2.0.0' }], status: 'ok' };
      analysis.components['npm:c'] = { key: 'npm:c', versions: [{ version: '3.0.0' }], status: 'ok' };

      analysis.addComponentError('legal', 'warnings', 'unknown', 'npm:a', '1.0.0');
      analysis.addComponentError('vulnerability', 'violations', 'CVE-HIGH', 'npm:b', '2.0.0');
      analysis.addComponentError('viability', 'warnings', 'low stars', 'npm:c');
      analysis.addComponentError('legal', 'violations', 'blacklisted', 'npm:c', '3.0.0');

      assert.equal(analysis.statistics.legal.warnings, 1);
      assert.equal(analysis.statistics.legal.violations, 1);
      assert.equal(analysis.statistics.vulnerability.violations, 1);
      assert.equal(analysis.statistics.viability.warnings, 1);

      const summary = Statistics.getSummary(analysis.statistics);
      assert.equal(summary.warnings, 2);  // legal.w(1) + viability.w(1)
      assert.equal(summary.violations, 2); // legal.v(1) + vuln.v(1)
      assert.equal(Statistics.getState(analysis.statistics), 'violations');
    });
  });
});
