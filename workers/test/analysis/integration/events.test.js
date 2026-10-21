import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { createStubDb } from '../helpers/stubDb.js';
import { Analysis, ModuleAnalyzer } from '../../../analysis/services/ModuleAnalyzer.js';
import { TSCheck } from '../../../analysis/services/TSCheck.js';

function loadEvent(n) {
  return JSON.parse(readFileSync(new URL(`../fixtures/event_${n}.json`, import.meta.url), 'utf8'));
}

function mockExternals() {
  TSCheck.CheckModule = mock.fn(async () => ({
    status: 200,
    data: {}
  }));
}

function emptyDb() {
  return createStubDb({
    components: [],
    infrastructureComponents: [],
    cves: [],
    manualVulnerabilities: [],
    capabilities: [],
    analysis: [],
    modules: [],
    logevents: [],
    companies: [],
    rules: []
  });
}

function runEvent(n) {
  const event = loadEvent(n);
  const raw = event.rawData;
  const db = emptyDb();
  const analyzer = new ModuleAnalyzer(
    db, raw.company, raw.project, raw.module,
    raw.scan, raw.user, raw.analysis, false, 'test-req'
  );
  return { analyzer, db, raw, event };
}

describe('Event file integration tests', () => {
  beforeEach(() => {
    mockExternals();
  });

  // ─── event_3: full config (viability, ossf, eol, versioning jump, encryption, obligations, cveWhitelist, licensesSelected, unchanged, looseCoupled) ───

  describe('event_3 - full config with viability+ossf+eol+encryption', () => {
    it('produces a valid analysis result', async () => {
      const { analyzer } = runEvent(3);
      const result = await analyzer.analyzeModule();

      assert.ok(result, 'analysis should return a result');
      assert.ok(result.statistics, 'result should have statistics');
      // analyzeModule returns raw Analysis object; components is a map, not array
      assert.ok(typeof result.components === 'object', 'result.components should be an object');
      assert.ok(typeof result.licenses === 'object', 'result.licenses should be an object');
    });

    it('gathers all scan dependencies as components', async () => {
      const { analyzer, raw } = runEvent(3);
      const result = await analyzer.analyzeModule();

      // event_3 has 1 root dep (ts-node-client-sample) with 8 sub-deps = 9 total unique components
      assert.ok(result.statistics.components >= 9,
        `expected >=9 components, got ${result.statistics.components}`);
    });

    it('normalizes mvn: to maven: in component keys', async () => {
      const { analyzer } = runEvent(3);
      const result = await analyzer.analyzeModule();

      const keys = result.components.map(c => c.key);
      // event_3 has 'mvn:org.apache.maven.wagon:wagon-provider-api' which should be normalized
      assert.ok(!keys.some(k => k.startsWith('mvn:')),
        'no component key should start with mvn: after normalization');
      assert.ok(keys.some(k => k.startsWith('maven:')),
        'normalized maven: keys should be present');
    });

    it('enables viabilityConfig from module', async () => {
      const { analyzer } = runEvent(3);
      const result = await analyzer.analyzeModule();

      assert.ok(result.viabilityConfig, 'viabilityConfig should be present');
      assert.equal(result.viabilityConfig.enabled, true);
    });

    it('enables ossfConfig from module', async () => {
      const { analyzer } = runEvent(3);
      const result = await analyzer.analyzeModule();

      assert.ok(result.ossfConfig, 'ossfConfig should be present');
      assert.equal(result.ossfConfig.enabled, true);
    });

    it('enables endoflifePolicy from module', async () => {
      const { analyzer } = runEvent(3);
      const result = await analyzer.analyzeModule();

      assert.ok(result.endoflifePolicy, 'endoflifePolicy should be present');
      assert.equal(result.endoflifePolicy.enabled, true);
      assert.equal(result.endoflifePolicy.warningThreshold, 12);
      assert.equal(result.endoflifePolicy.violationThreshold, 3);
    });

    it('has encryption config from company algorithmsConfig', async () => {
      const { analyzer } = runEvent(3);
      const result = await analyzer.analyzeModule();

      assert.ok(result.algorithmsConfig, 'algorithmsConfig should be present');
      assert.ok(result.algorithmsConfig.length > 0, 'should have at least one algorithm');
      assert.equal(result.algorithmsConfig[0].key, 'Bcrypt');
    });

    it('has license whitelist from company (Apache-2.0)', async () => {
      const { raw } = runEvent(3);
      assert.ok(raw.company.licenseConfig.whitelist.some(l => l.key === 'Apache-2.0'));
    });

    it('has component whitelist from company', async () => {
      const { raw } = runEvent(3);
      assert.ok(raw.company.componentConfig.whitelist.some(c => c.key === 'sysvinit:utils'));
    });

    it('statistics structure has all expected categories', async () => {
      const { analyzer } = runEvent(3);
      const result = await analyzer.analyzeModule();
      const s = result.statistics;

      assert.ok('legal' in s, 'should have legal stats');
      assert.ok('vulnerability' in s, 'should have vulnerability stats');
      assert.ok('viability' in s, 'should have viability stats');
      assert.ok('versioning' in s, 'should have versioning stats');
      assert.ok('encryption' in s, 'should have encryption stats');
      assert.ok('ossf' in s, 'should have ossf stats');
      assert.ok('endoflife' in s, 'should have endoflife stats');
      assert.ok('integrity' in s, 'should have integrity stats');
      assert.ok(typeof s.components === 'number');
      assert.ok(typeof s.licenses === 'number');
    });

    it('saves result to analysis collection', async () => {
      const { analyzer, db } = runEvent(3);
      await analyzer.analyze();
      assert.ok(db._collections.analysis.length > 0, 'analysis should be saved to DB');
    });
  });

  // ─── event_4: large scan (pdfmake with deep dep tree), minimal config ───

  describe('event_4 - pdfmake with deep dependency tree, minimal config', () => {
    it('produces a valid analysis result', async () => {
      const { analyzer } = runEvent(4);
      const result = await analyzer.analyzeModule();

      assert.ok(result);
      assert.ok(result.statistics);
      assert.ok(result.statistics.components > 0);
    });

    it('has no viability/ossf/endoflife config (all disabled)', async () => {
      const { analyzer } = runEvent(4);
      const result = await analyzer.analyzeModule();

      // Module has no enabled viability/ossf/eol
      assert.deepEqual(result.viabilityConfig, {});
      assert.deepEqual(result.ossfConfig, {});
      assert.deepEqual(result.endoflifePolicy, {});
    });

    it('has CVE whitelist in module config', async () => {
      const { raw } = runEvent(4);
      assert.ok(raw.module.cveConfig.whitelist.length > 0);
      assert.equal(raw.module.cveConfig.whitelist[0].cveKey, 'CVE-2007-2405');
    });

    it('has previous analysis (lastAnalysis) for jump detection', async () => {
      const { raw } = runEvent(4);
      assert.ok(raw.analysis, 'should have lastAnalysis');
      assert.ok(raw.analysis.components.length > 0);
    });
  });

  // ─── event_5: minimal scan (2 deps), algorithmsConfig present ───

  describe('event_5 - minimal scan with algorithmsConfig', () => {
    it('produces a valid analysis with 2 components', async () => {
      const { analyzer } = runEvent(5);
      const result = await analyzer.analyzeModule();

      assert.ok(result);
      assert.equal(result.statistics.components, 2);
    });

    it('has algorithmsConfig from company', async () => {
      const { analyzer } = runEvent(5);
      const result = await analyzer.analyzeModule();

      assert.ok(result.algorithmsConfig);
      assert.ok(result.algorithmsConfig.length >= 1);
    });

    it('has no viability/ossf/endoflife (not enabled in module)', async () => {
      const { analyzer } = runEvent(5);
      const result = await analyzer.analyzeModule();

      assert.deepEqual(result.viabilityConfig, {});
      assert.deepEqual(result.ossfConfig, {});
      assert.deepEqual(result.endoflifePolicy, {});
    });
  });

  // ─── event_6: no scan dependencies ───

  describe('event_6 - scan with no dependencies', () => {
    it('returns an analysis with 0 components (scan exists but has no deps)', async () => {
      const { analyzer } = runEvent(6);
      const result = await analyzer.analyzeModule();

      // Scan object exists (has _id) so analyzeModule proceeds, but with 0 deps
      assert.ok(result, 'should return an Analysis (scan is not null)');
      assert.equal(result.statistics.components, 0);
    });
  });

  // ─── event_7: large scan with requireWhitelist, license WL/BL, viability+ossf, blacklisted licenses ───

  describe('event_7 - large scan with requireWhitelist + license BL + viability + ossf', () => {
    it('produces a valid analysis result', async () => {
      const { analyzer } = runEvent(7);
      const result = await analyzer.analyzeModule();

      assert.ok(result);
      assert.ok(result.statistics);
      assert.ok(result.statistics.components > 0);
    });

    it('company has requireWhitelist=true', async () => {
      const { raw } = runEvent(7);
      assert.equal(raw.company.requireWhitelist, true);
    });

    it('company has 27 whitelisted and 6 blacklisted licenses', async () => {
      const { raw } = runEvent(7);
      assert.equal(raw.company.licenseConfig.whitelist.length, 27);
      assert.equal(raw.company.licenseConfig.blacklist.length, 6);
    });

    it('enables viability and ossf from module', async () => {
      const { analyzer } = runEvent(7);
      const result = await analyzer.analyzeModule();

      assert.ok(result.viabilityConfig);
      assert.equal(result.viabilityConfig.enabled, true);
      assert.ok(result.ossfConfig);
      assert.equal(result.ossfConfig.enabled, true);
    });

    it('has license statistics reflecting whitelist enforcement', async () => {
      const { analyzer } = runEvent(7);
      const result = await analyzer.analyzeModule();

      assert.ok(result.statistics.licenses > 0, 'should find licenses');
    });
  });

  // ─── cross-event comparisons ───

  describe('cross-event comparisons', () => {
    it('event_3 (with viability) has viabilityConfig, event_5 (without) does not', async () => {
      const r3 = runEvent(3);
      const r5 = runEvent(5);
      const [result3, result5] = await Promise.all([
        r3.analyzer.analyzeModule(),
        r5.analyzer.analyzeModule()
      ]);

      assert.equal(result3.viabilityConfig.enabled, true);
      assert.deepEqual(result5.viabilityConfig, {});
    });

    it('event_3 (with eol) has endoflifePolicy, event_4 (without) does not', async () => {
      const r3 = runEvent(3);
      const r4 = runEvent(4);
      const [result3, result4] = await Promise.all([
        r3.analyzer.analyzeModule(),
        r4.analyzer.analyzeModule()
      ]);

      assert.equal(result3.endoflifePolicy.enabled, true);
      assert.deepEqual(result4.endoflifePolicy, {});
    });

    it('event_6 (no deps) has 0 components, event_5 (with deps) has 2', async () => {
      const r5 = runEvent(5);
      const r6 = runEvent(6);
      const [result5, result6] = await Promise.all([
        r5.analyzer.analyzeModule(),
        r6.analyzer.analyzeModule()
      ]);

      assert.equal(result5.statistics.components, 2);
      assert.equal(result6.statistics.components, 0);
    });

    it('event_3 and event_5 have different component counts', async () => {
      const r3 = runEvent(3);
      const r5 = runEvent(5);
      const [result3, result5] = await Promise.all([
        r3.analyzer.analyzeModule(),
        r5.analyzer.analyzeModule()
      ]);

      // event_3 has 9+ components, event_5 has 2
      assert.ok(result3.statistics.components > result5.statistics.components,
        'event_3 should have more components than event_5');
    });
  });
});
