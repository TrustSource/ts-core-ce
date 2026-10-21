/* eslint-disable no-undef */
// Pure unit test for the SBOM details view helpers introduced for
// No Meteor, no Blaze, no running app - requires the helper module directly so
// the theme-aware pie slice colors and the CycloneDX dropdown variant mapping
// can be asserted in isolation. The CSS/Blaze rendering (dark pagination, pie
// at 0%, dropdown markup) is verified manually by QA - only the testable JS
// logic lives here.
//
// Maps to acceptance criteria 4/5/6/7 (slice colors chosen by theme at render
// time) and 8/9/10 (AIBOM dropdown item -> getCycloneDxDetails type + filename
// suffix; existing SBOM/CBOM/combined output unchanged).
const {
  getChartSliceColors,
  getCycloneDxVariant
} = require('../../imports/client/ui/reports/report-sbom/sbomDetailsHelpers');

describe('sbomDetailsHelpers', () => {
  describe('getChartSliceColors', () => {
    it('returns teal done + dark remaining slice in dark mode (criterion 4/7)', () => {
      expect(getChartSliceColors(true)).toEqual(['#2a94a2', '#373737']);
    });

    it('returns teal done + light remaining slice in light mode (criterion 6)', () => {
      expect(getChartSliceColors(false)).toEqual(['#2a94a2', '#eeeeee']);
    });

    it('keeps the done slice teal #2a94a2 in both themes (criterion 5)', () => {
      expect(getChartSliceColors(true)[0]).toBe('#2a94a2');
      expect(getChartSliceColors(false)[0]).toBe('#2a94a2');
    });

    it('never returns the light #eeeeee remaining slice in dark mode (criterion 4)', () => {
      expect(getChartSliceColors(true)).not.toContain('#eeeeee');
    });
  });

  describe('getCycloneDxVariant', () => {
    it('maps SBOM -> components type with sbom file suffix (criterion 10)', () => {
      expect(getCycloneDxVariant('SBOM')).toEqual({type: 'SBOM', suffix: '-sbom-file-'});
    });

    it('maps CBOM -> crypto type with cbom file suffix (criterion 10)', () => {
      expect(getCycloneDxVariant('CBOM')).toEqual({type: 'CBOM', suffix: '-cbom-file-'});
    });

    it('maps AIBOM -> AI type with aibom file suffix (criterion 9)', () => {
      expect(getCycloneDxVariant('AIBOM')).toEqual({type: 'AIBOM', suffix: '-aibom-file-'});
    });

    it('maps FULL -> undefined type (combined) keeping the sbom file suffix (criterion 10)', () => {
      expect(getCycloneDxVariant('FULL')).toEqual({type: undefined, suffix: '-sbom-file-'});
    });

    it('falls back to the SBOM variant for an unknown value', () => {
      expect(getCycloneDxVariant('NOPE')).toEqual({type: 'SBOM', suffix: '-sbom-file-'});
    });
  });
});
