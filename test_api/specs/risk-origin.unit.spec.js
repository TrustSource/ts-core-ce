/* eslint-disable no-undef */
// Pure unit test for the canonical risk-origin lists + validator. No Meteor,
// no running app, no API key - requires the helper directly and asserts the
// exact origin enum, the UI option list, and the allowed-origin guard.
//
// Maps to acceptance criteria 4 (TMA Assessment is a canonical origin),
// 8/9 (legacy codes + threat-model legacy entry preserved) and 15 (the
// origin enum is the single source of truth shared by schema validation and
// the UI dropdown). The end-to-end HTTP assertions live in risks.spec.js,
// which needs a live app.
const {
  RISK_ORIGIN_VALUES,
  RISK_ORIGIN_OPTIONS,
  isAllowedOrigin
} = require('../../imports/lib/interactors/riskProperties/riskOrigin');

describe('riskProperties riskOrigin', () => {
  describe('RISK_ORIGIN_VALUES', () => {
    it('is the exact canonical origin enum (criterion 4)', () => {
      expect(RISK_ORIGIN_VALUES).toEqual([
        '', 'SDLC', 'SQ', 'SSC', 'CVE', 'YARA', 'CWE', 'TD',
        'TMA Assessment', 'LIC', 'threat-model'
      ]);
    });

    it('includes the empty string so blank UI/clean() paths stay valid', () => {
      expect(RISK_ORIGIN_VALUES).toContain('');
    });

    it('includes TMA Assessment (criterion 4)', () => {
      expect(RISK_ORIGIN_VALUES).toContain('TMA Assessment');
    });

    it('includes LIC, the origin a manual license resolution files (issue #139)', () => {
      expect(RISK_ORIGIN_VALUES).toContain('LIC');
    });

    it('keeps LIC BEFORE threat-model, which stays the last member', () => {
      expect(RISK_ORIGIN_VALUES.indexOf('LIC'))
        .toBeLessThan(RISK_ORIGIN_VALUES.indexOf('threat-model'));
      expect(RISK_ORIGIN_VALUES[RISK_ORIGIN_VALUES.length - 1]).toBe('threat-model');
    });

    it('keeps threat-model for back-compat with agent-created risks (criterion 9)', () => {
      expect(RISK_ORIGIN_VALUES).toContain('threat-model');
    });

    it('has no duplicate values (enum integrity - a dup would weaken allowedValues silently)', () => {
      expect(RISK_ORIGIN_VALUES.length).toBe(new Set(RISK_ORIGIN_VALUES).size);
    });
  });

  describe('RISK_ORIGIN_OPTIONS', () => {
    it('is the exact option list - values, labels, and order (full contract)', () => {
      // Locks the dropdown contract: legacy codes first in their canonical order,
      // TMA Assessment with its exact label, threat-model (legacy) last. A drift
      // in label text or ordering breaks this.
      expect(RISK_ORIGIN_OPTIONS).toEqual([
        {value: 'SDLC', label: 'Software Development Lifecycle (SDLC)'},
        {value: 'SQ', label: 'Software/Code Quality (SQ)'},
        {value: 'SSC', label: 'Software Supply Chain (SSC)'},
        {value: 'CVE', label: 'Vulnerability (CVE)'},
        {value: 'YARA', label: 'Malware (YARA)'},
        {value: 'CWE', label: 'Assessment (CWE), weaknesses from risk or sec assessments'},
        {value: 'TD', label: 'Technical Debt (TD) , e.g. old versions'},
        {value: 'TMA Assessment', label: 'Threat Model Assessment (TMA)'},
        {value: 'LIC', label: 'Unmatched License (LIC)'},
        {value: 'threat-model', label: 'Threat Model (legacy)'}
      ]);
    });

    it('contains the TMA Assessment option with its label (criterion 4)', () => {
      expect(RISK_ORIGIN_OPTIONS).toContainEqual({
        value: 'TMA Assessment',
        label: 'Threat Model Assessment (TMA)'
      });
    });

    it('contains the LIC option with its label (issue #139)', () => {
      expect(RISK_ORIGIN_OPTIONS).toContainEqual({
        value: 'LIC',
        label: 'Unmatched License (LIC)'
      });
    });

    it('contains a threat-model legacy option (criterion 9)', () => {
      const legacy = RISK_ORIGIN_OPTIONS.find(o => o.value === 'threat-model');
      expect(legacy).toBeTruthy();
      expect(legacy.label).toMatch(/legacy/i);
    });

    it('lists the threat-model legacy option last (criterion 9)', () => {
      expect(RISK_ORIGIN_OPTIONS[RISK_ORIGIN_OPTIONS.length - 1].value).toBe('threat-model');
    });

    it('every option value is a member of RISK_ORIGIN_VALUES (criterion 15)', () => {
      RISK_ORIGIN_OPTIONS.forEach(o => expect(RISK_ORIGIN_VALUES).toContain(o.value));
    });

    it('exposes all 7 legacy codes as selectable options (criterion 8)', () => {
      const values = RISK_ORIGIN_OPTIONS.map(o => o.value);
      ['SDLC', 'SQ', 'SSC', 'CVE', 'YARA', 'CWE', 'TD'].forEach(code =>
        expect(values).toContain(code)
      );
    });

    it('does NOT offer the empty string as a selectable option', () => {
      expect(RISK_ORIGIN_OPTIONS.map(o => o.value)).not.toContain('');
    });

    it('blank-option invariant: "" is a valid VALUE but never an OPTION', () => {
      // The blank choice is rendered by the template, not by the option list, yet
      // it must still validate on clean()/blank-submit paths. These two facts move
      // together - assert them as a pair so neither side drifts.
      expect(RISK_ORIGIN_VALUES).toContain('');
      expect(RISK_ORIGIN_OPTIONS.map(o => o.value)).not.toContain('');
    });

    it('offers every non-blank canonical value exactly once (options ⇔ values minus "")', () => {
      const optionValues = RISK_ORIGIN_OPTIONS.map(o => o.value);
      const nonBlankValues = RISK_ORIGIN_VALUES.filter(v => v !== '');
      expect(optionValues).toEqual(nonBlankValues);
    });
  });

  describe('isAllowedOrigin', () => {
    it('accepts the empty string', () => {
      expect(isAllowedOrigin('')).toBe(true);
    });
    it('accepts every canonical origin value individually', () => {
      // Covers all legacy codes plus TMA Assessment and threat-model (criteria 4, 8, 9).
      RISK_ORIGIN_VALUES.forEach(v => expect(isAllowedOrigin(v)).toBe(true));
    });
    it('accepts a legacy code (CVE)', () => {
      expect(isAllowedOrigin('CVE')).toBe(true);
    });
    it('accepts the legacy threat-model value (criterion 9)', () => {
      expect(isAllowedOrigin('threat-model')).toBe(true);
    });
    it('accepts TMA Assessment (criterion 4)', () => {
      expect(isAllowedOrigin('TMA Assessment')).toBe(true);
    });
    it('accepts LIC (issue #139)', () => {
      expect(isAllowedOrigin('LIC')).toBe(true);
      expect(isAllowedOrigin('lic')).toBe(false);
    });
    it('rejects an unknown origin (criterion 6 - API validation)', () => {
      expect(isAllowedOrigin('BOGUS')).toBe(false);
    });
    it('is case-sensitive - a wrong-case legacy code is rejected', () => {
      expect(isAllowedOrigin('cve')).toBe(false);
      expect(isAllowedOrigin('tma assessment')).toBe(false);
    });
    it('rejects non-string inputs (element-level guard, not array-level)', () => {
      // The guard tests membership in the value enum, so anything that is not an
      // exact enum string is false. It is NOT meant to be handed an array of
      // origins - the schema validates each array element individually.
      [null, undefined, 0, 1, NaN, true, false, [], ['CVE'], {}, {value: 'CVE'}]
        .forEach(input => expect(isAllowedOrigin(input)).toBe(false));
    });
  });
});
