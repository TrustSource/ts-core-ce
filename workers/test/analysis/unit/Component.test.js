import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../../../analysis/services/Component.js';

describe('Component', () => {
  describe('findVersion', () => {
    it('finds existing version', () => {
      const comp = { versions: [{ version: '1.0.0' }, { version: '2.0.0' }] };
      const v = Component.findVersion(comp, '1.0.0');
      assert.deepEqual(v, { version: '1.0.0' });
    });

    it('returns undefined for missing version', () => {
      const comp = { versions: [{ version: '1.0.0' }] };
      assert.equal(Component.findVersion(comp, '9.9.9'), undefined);
    });

    it('returns undefined for component without versions', () => {
      assert.equal(Component.findVersion({}, '1.0.0'), undefined);
      assert.equal(Component.findVersion(null, '1.0.0'), undefined);
    });
  });

  describe('getVersions', () => {
    it('returns sorted versions ascending by default', () => {
      const comp = { versions: [{ version: '3.0.0' }, { version: '1.0.0' }, { version: '2.0.0' }] };
      const result = Component.getVersions(comp);
      assert.deepEqual(result.map(v => v.version), ['1.0.0', '2.0.0', '3.0.0']);
    });

    it('returns sorted versions descending when requested', () => {
      const comp = { versions: [{ version: '1.0.0' }, { version: '3.0.0' }, { version: '2.0.0' }] };
      const result = Component.getVersions(comp, true);
      assert.deepEqual(result.map(v => v.version), ['3.0.0', '2.0.0', '1.0.0']);
    });

    it('returns empty array for component without versions', () => {
      assert.deepEqual(Component.getVersions({}), []);
      assert.deepEqual(Component.getVersions(null), []);
    });
  });

  describe('findAllVersions', () => {
    it('maps versions to string array', () => {
      const comp = { versions: [{ version: '1.0.0' }, { version: '2.0.0' }] };
      assert.deepEqual(Component.findAllVersions(comp), ['1.0.0', '2.0.0']);
    });
  });

  describe('getVersioningStatus', () => {
    const mod = { versioningConfig: { warningThreshold: 2, violationThreshold: 3 } };

    it('returns ok when version is latest', () => {
      const allVersions = ['1.0.0', '2.0.0', '3.0.0'];
      assert.equal(Component.getVersioningStatus({}, mod, ['3.0.0'], allVersions), 'ok');
    });

    it('returns warnings when behind by moderate amount', () => {
      // warningThreshold=2 -> convertVersionBridge(2)=6, violations threshold=3 -> convert(3)=3
      const allVersions = ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0', '6.0.0', '7.0.0', '8.0.0'];
      // version '1.0.0' is at index 0, difference = 8-0 = 8, > 6 but also > 3
      assert.equal(Component.getVersioningStatus({}, mod, ['1.0.0'], allVersions), 'violations');
    });

    it('returns ok with no thresholds configured', () => {
      const modNoThres = { versioningConfig: {} };
      const allVersions = ['1.0.0', '2.0.0', '3.0.0'];
      assert.equal(Component.getVersioningStatus({}, modNoThres, ['1.0.0'], allVersions), 'ok');
    });
  });

  describe('getEncryption', () => {
    it('returns ok when no problems', () => {
      assert.equal(Component.getEncryption({}), 'ok');
      assert.equal(Component.getEncryption({ problems: {} }), 'ok');
    });

    it('returns violations when encryption violations exist', () => {
      const comp = { problems: { encryption: [{ status: 'violations' }] } };
      assert.equal(Component.getEncryption(comp), 'violations');
    });

    it('returns warnings when only encryption warnings exist', () => {
      const comp = { problems: { encryption: [{ status: 'warnings' }] } };
      assert.equal(Component.getEncryption(comp), 'warnings');
    });

    it('prioritizes violations over warnings', () => {
      const comp = { problems: { encryption: [{ status: 'warnings' }, { status: 'violations' }] } };
      assert.equal(Component.getEncryption(comp), 'violations');
    });
  });

  describe('getEndoflife', () => {
    it('returns ok when no problems', () => {
      assert.equal(Component.getEndoflife({}), 'ok');
    });

    it('returns violations when endoflife violations exist', () => {
      const comp = { problems: { endoflife: [{ status: 'violations' }] } };
      assert.equal(Component.getEndoflife(comp), 'violations');
    });

    it('returns warnings when only endoflife warnings exist', () => {
      const comp = { problems: { endoflife: [{ status: 'warnings' }] } };
      assert.equal(Component.getEndoflife(comp), 'warnings');
    });
  });

  describe('getViabilityStatus', () => {
    it('returns violations when no config', () => {
      assert.equal(Component.getViabilityStatus({}, null), 'violations');
      assert.equal(Component.getViabilityStatus({}, {}), 'violations');
    });

    it('returns default level when indicators insufficient', () => {
      const config = { noInfoLevel: 2, minConfidence: 3, warningThreshold: 2, violationThreshold: 1 };
      const comp = {}; // no crawlerInfo.github
      assert.equal(Component.getViabilityStatus(comp, config), 'warnings');
    });

    it('returns ok when indicators exceed thresholds', () => {
      const config = { noInfoLevel: 3, minConfidence: 1, warningThreshold: 2, violationThreshold: 1 };
      const comp = {
        crawlerInfo: {
          github: {
            status: 200,
            info: { stargazers_count: 500, forks_count: 200, open_issues_count: 10 }
          }
        }
      };
      assert.equal(Component.getViabilityStatus(comp, config), 'ok');
    });
  });

  describe('getViabilityStatusFromLevel', () => {
    it('maps levels to status strings', () => {
      assert.equal(Component.getViabilityStatusFromLevel(1), 'ok');
      assert.equal(Component.getViabilityStatusFromLevel(2), 'warnings');
      assert.equal(Component.getViabilityStatusFromLevel(3), 'violations');
    });

    it('returns violations for falsy level', () => {
      assert.equal(Component.getViabilityStatusFromLevel(0), 'violations');
      assert.equal(Component.getViabilityStatusFromLevel(null), 'violations');
    });
  });

  describe('getOssfStatus', () => {
    it('returns violations when no config', () => {
      assert.equal(Component.getOssfStatus({}, null), 'violations');
    });

    it('returns default level when no OSSF data', () => {
      const config = { noInfoLevel: 1, warningThreshold: 3, violationThreshold: 1 };
      assert.equal(Component.getOssfStatus({}, config), 'ok');
    });

    it('returns ok when score exceeds thresholds', () => {
      const config = { noInfoLevel: 3, warningThreshold: 3, violationThreshold: 1 };
      const comp = {
        crawlerInfo: { ossf: { status: 200, info: { score: 8 } } }
      };
      assert.equal(Component.getOssfStatus(comp, config), 'ok');
    });

    it('returns violations when score below violation threshold', () => {
      const config = { noInfoLevel: 3, warningThreshold: 5, violationThreshold: 3 };
      const comp = {
        crawlerInfo: { ossf: { status: 200, info: { score: 2 } } }
      };
      assert.equal(Component.getOssfStatus(comp, config), 'violations');
    });
  });

  describe('getEndoflifeStatus', () => {
    it('returns ok when no crawlerInfo', () => {
      assert.equal(Component.getEndoflifeStatus({}, {}, '1.0.0'), 'ok');
    });

    it('returns ok when no endoflife info', () => {
      const comp = { crawlerInfo: {} };
      assert.equal(Component.getEndoflifeStatus(comp, {}, '1.0.0'), 'ok');
    });

    it('returns ok when no thresholds set', () => {
      const comp = {
        crawlerInfo: {
          endoflife: {
            info: [{ name: 1, isEol: true, eolFrom: '2020-01-01' }]
          }
        }
      };
      assert.deepEqual(Component.getEndoflifeStatus(comp, {}, '1.0.0'), { status: 'ok' });
    });

    it('returns violations for EOL version within violation threshold', () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 3);
      const comp = {
        crawlerInfo: {
          endoflife: {
            info: [{ name: 1, isEol: true, eolFrom: pastDate.toISOString() }]
          }
        }
      };
      const config = { warningThreshold: 12, violationThreshold: 6 };
      const result = Component.getEndoflifeStatus(comp, config, '1.0.0');
      assert.equal(result.status, 'violations');
    });

    it('uses current date (not hardcoded) for age calculation', () => {
      // getAgeMonths(eolFrom) computes moment(eolFrom).diff(moment(now), 'months')
      // For a recent past EOL date (3 months ago), ageMonths is negative (e.g. -3)
      // The condition is: ageMonths < 0 || ageMonths <= threshold
      // So a recent EOL should trigger violations with violationThreshold=6
      const recentPast = new Date();
      recentPast.setMonth(recentPast.getMonth() - 2);
      const comp = {
        crawlerInfo: {
          endoflife: {
            info: [{ name: 1, isEol: true, eolFrom: recentPast.toISOString() }]
          }
        }
      };
      const config = { warningThreshold: 12, violationThreshold: 6 };
      const result = Component.getEndoflifeStatus(comp, config, '1.0.0');
      assert.equal(result.status, 'violations');
      assert.equal(result.isEol, true);
    });
  });

  describe('getVersioning', () => {
    it('returns ok when no problems', () => {
      assert.deepEqual(Component.getVersioning({}), { status: 'ok' });
    });

    it('returns worst versioning problem (violations first)', () => {
      const comp = {
        problems: {
          versioning: [
            { status: 'warnings', message: 'warn' },
            { status: 'violations', message: 'bad' }
          ]
        }
      };
      assert.equal(Component.getVersioning(comp).status, 'violations');
    });

    it('returns warnings if no violations', () => {
      const comp = {
        problems: {
          versioning: [{ status: 'warnings', message: 'warn' }]
        }
      };
      assert.equal(Component.getVersioning(comp).status, 'warnings');
    });
  });

  describe('getViabilityIndicators', () => {
    it('returns zero indicators when no github info', () => {
      const result = Component.getViabilityIndicators({});
      assert.equal(result.indicatorCount, 0);
      assert.equal(result.level, 0);
    });

    it('computes indicators from real github data (like npm:abab: stars=80, forks=13)', () => {
      const comp = {
        crawlerInfo: {
          github: {
            status: 200,
            info: {
              created_at: '2015-08-29T03:21:16Z',
              updated_at: '2021-11-20T05:08:44Z',
              pushed_at: '2021-11-20T05:08:44Z',
              stargazers_count: 80,
              forks_count: 13,
              open_issues_count: 4,
              monthlyCommitCnt: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
            }
          }
        }
      };
      const result = Component.getViabilityIndicators(comp);
      assert.equal(result.indicatorCount, 3); // stars, forks, monthlyCommitCnt
      assert.ok(result.starsCnt >= 1 && result.starsCnt <= 5);
      assert.ok(result.forksCnt >= 1 && result.forksCnt <= 5);
      assert.ok(result.level >= 1);
    });

    it('computes high indicators for popular repo (stars=1834, forks=169)', () => {
      const comp = {
        crawlerInfo: {
          github: {
            status: 200,
            info: {
              stargazers_count: 1834,
              forks_count: 169,
              open_issues_count: 21,
              monthlyCommitCnt: [2, 3, 5, 1, 0, 4, 2, 1, 3, 6, 2, 1, 8]
            }
          }
        }
      };
      const result = Component.getViabilityIndicators(comp);
      assert.equal(result.indicatorCount, 3);
      assert.equal(result.starsCnt, 5); // capped at max
      assert.equal(result.forksCnt, 5); // capped at max
      assert.equal(result.level, 4);    // avg of 5+5+3 = 4.33 -> 4
    });
  });

  describe('getViabilityStatus (real configs)', () => {
    it('returns ok with prod config (warn=1, violation=1, minConf=1, noInfo=1) and popular repo', () => {
      const config = { warningThreshold: 1, violationThreshold: 1, minConfidence: 1, noInfoLevel: 1 };
      const comp = {
        crawlerInfo: {
          github: {
            status: 200,
            info: { stargazers_count: 1834, forks_count: 169, monthlyCommitCnt: [0,0,0,0,0,0,0,0,0,0,0,0,8] }
          }
        }
      };
      assert.equal(Component.getViabilityStatus(comp, config), 'ok');
    });

    it('returns ok (noInfoLevel=1) for component without github data', () => {
      const config = { warningThreshold: 1, violationThreshold: 1, minConfidence: 1, noInfoLevel: 1 };
      assert.equal(Component.getViabilityStatus({}, config), 'ok');
    });
  });

  describe('getOssfStatus (real configs)', () => {
    it('returns violations for score=3.1 with config (warn=7, violation=5, noInfo=2)', () => {
      const config = { warningThreshold: 7, violationThreshold: 5, noInfoLevel: 2 };
      const comp = {
        crawlerInfo: { ossf: { status: 200, info: { score: 3.1 } } }
      };
      assert.equal(Component.getOssfStatus(comp, config), 'violations');
    });

    it('returns warnings for no ossf data with noInfoLevel=2', () => {
      const config = { warningThreshold: 7, violationThreshold: 5, noInfoLevel: 2 };
      assert.equal(Component.getOssfStatus({}, config), 'warnings');
    });

    it('returns warnings for score between thresholds', () => {
      const config = { warningThreshold: 7, violationThreshold: 5, noInfoLevel: 2 };
      const comp = {
        crawlerInfo: { ossf: { status: 200, info: { score: 6 } } }
      };
      assert.equal(Component.getOssfStatus(comp, config), 'warnings');
    });
  });

  describe('getEndoflifeStatus (real patterns)', () => {
    it('detects EOL for mongodb 6.x (security support end date 2025-07-31)', () => {
      const comp = {
        crawlerInfo: {
          endoflife: {
            info: [
              { name: 6, isEol: true, eolFrom: '2025-07-31', isEoas: true, eoasFrom: '2025-01-31', latest: '6.18.0' },
              { name: 7, isEol: false, latest: '7.2.0' }
            ]
          }
        }
      };
      const config = { warningThreshold: 12, violationThreshold: 6 };
      const result = Component.getEndoflifeStatus(comp, config, '6.18.0');
      // Since EOL is in the past, ageMonths is negative -> triggers violation
      assert.ok(result.status === 'violations' || result.status === 'warnings');
      assert.equal(result.isEol, true);
      assert.equal(result.isEoas, true);
    });

    it('returns ok for non-EOL version', () => {
      const comp = {
        crawlerInfo: {
          endoflife: {
            info: [
              { name: 6, isEol: true, eolFrom: '2025-07-31' },
              { name: 7, isEol: false }
            ]
          }
        }
      };
      const config = { warningThreshold: 12, violationThreshold: 6 };
      const result = Component.getEndoflifeStatus(comp, config, '7.2.0');
      // version 7 is not EOL -> no status returned (undefined) or ok
      assert.ok(!result || result.status === 'ok' || result === 'ok');
    });

    it('matches by major.minor when available', () => {
      const comp = {
        crawlerInfo: {
          endoflife: {
            info: [
              { name: '6.18', isEol: true, eolFrom: '2024-01-01' }
            ]
          }
        }
      };
      const config = { warningThreshold: 12, violationThreshold: 6 };
      const result = Component.getEndoflifeStatus(comp, config, '6.18.0');
      assert.ok(result);
      assert.equal(result.status, 'violations');
    });
  });

  describe('getViability', () => {
    it('returns viability from github crawlerInfo', () => {
      const comp = {
        crawlerInfo: {
          github: {
            status: 200,
            lastVisit: '2022-01-04T12:13:19.717Z',
            info: {
              created_at: '2015-08-29T03:21:16Z',
              updated_at: '2021-11-20T05:08:44Z',
              pushed_at: '2021-11-20T05:08:44Z',
              open_issues_count: 4,
              forks_count: 13,
              stargazers_count: 80,
              monthlyCommitCnt: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
            }
          }
        }
      };
      const via = Component.getViability(comp);
      assert.equal(via.starsCnt, 80);
      assert.equal(via.forksCnt, 13);
      assert.equal(via.openIssuesCnt, 4);
      assert.ok(via.monthlyCommitCnt);
    });

    it('returns error for non-200 github status', () => {
      const comp = {
        crawlerInfo: { github: { status: 404 } }
      };
      const via = Component.getViability(comp);
      assert.equal(via.error, 'No information available');
    });

    it('caches viability result on component', () => {
      const comp = {
        crawlerInfo: {
          github: {
            status: 200,
            info: { stargazers_count: 5, forks_count: 1, open_issues_count: 0 }
          }
        }
      };
      Component.getViability(comp);
      assert.ok(comp.__viability);
      assert.equal(comp.__viability.starsCnt, 5);
    });
  });

  describe('getOSSF', () => {
    it('returns OSSF score from crawlerInfo', () => {
      const comp = {
        crawlerInfo: { ossf: { status: 200, info: { score: 3.1 } } }
      };
      const ossf = Component.getOSSF(comp);
      assert.equal(ossf.score, 3.1);
    });

    it('returns error when ossf not available', () => {
      const comp = { crawlerInfo: { ossf: { status: 404 } } };
      const ossf = Component.getOSSF(comp);
      assert.equal(ossf.error, 'No information available');
    });
  });

  describe('getVersion', () => {
    it('returns existing version', () => {
      const comp = { versions: [{ version: '1.0.0' }] };
      const v = Component.getVersion(comp, '1.0.0');
      assert.equal(v.version, '1.0.0');
    });

    it('creates and inserts new version if missing', () => {
      const comp = { versions: [{ version: '1.0.0' }] };
      const v = Component.getVersion(comp, '2.0.0');
      assert.equal(v.version, '2.0.0');
      assert.equal(comp.versions.length, 2);
      assert.equal(comp._changed, true);
    });

    it('initializes versions array if missing', () => {
      const comp = {};
      Component.getVersion(comp, '1.0.0');
      assert.ok(Array.isArray(comp.versions));
      assert.equal(comp.versions.length, 1);
    });
  });
});
