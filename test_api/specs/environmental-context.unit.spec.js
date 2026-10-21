/* eslint-disable no-undef */
// Pure unit test for the environmental-context helpers. No Meteor, no
// running app - requires the dependency-free CommonJS module directly (same
// pattern as riskProperties/listQuery.js). This is the single source of truth
// used by BOTH REST routes (modules + projects environmental-context).
//
// Contract:
//   parseMav(vectorString):
//     /(?:^|\/)MAV:([NALPX])(?=\/|$)/ case-sensitive; null if !string / !match /
//     m[1]==='X'; otherwise the letter. v2 vectors are never inspected.
//   toEnvironmentalContext(module):
//     {moduleId, projectId|null, name|null, ciaRequirements:{CR,IR,AR}|null,
//      environmentalConfig:{v2vectorString,v3vectorString,v4vectorString each
//      null when absent}, mav} where mav = parseMav(v4) || parseMav(v3) || null.
//     ciaRequirements passes through stored discrete letters verbatim (no X
//     synthesis); null when the module has no ciaRequirements.
const {parseMav, toEnvironmentalContext} = require('../../imports/lib/converter/environmentalContext');

describe('#104 parseMav', () => {
  describe('every MAV token in a v3 vector', () => {
    const base = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
    ['N', 'A', 'L', 'P'].forEach((tok) => {
      it(`extracts MAV:${tok}`, () => {
        expect(parseMav(`${base}/MAV:${tok}`)).toBe(tok);
      });
    });
  });

  describe('every MAV token in a v4 vector', () => {
    const base = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
    ['N', 'A', 'L', 'P'].forEach((tok) => {
      it(`extracts MAV:${tok}`, () => {
        expect(parseMav(`${base}/MAV:${tok}`)).toBe(tok);
      });
    });
  });

  it('returns null for MAV:X (explicitly not-defined)', () => {
    expect(parseMav('CVSS:3.1/AV:N/MAV:X')).toBeNull();
  });

  it('returns null when there is no MAV token at all', () => {
    expect(parseMav('CVSS:3.1/AV:N/AC:L/C:H/I:H/A:H')).toBeNull();
  });

  it('matches MAV at the start of the string (^ anchor)', () => {
    expect(parseMav('MAV:N/AV:N')).toBe('N');
  });

  it('matches MAV at the end of the string ($ anchor)', () => {
    expect(parseMav('CVSS:3.1/AV:N/MAV:L')).toBe('L');
  });

  it('is case-sensitive: lowercase key or value does not match', () => {
    expect(parseMav('CVSS:3.1/mav:N')).toBeNull();
    expect(parseMav('CVSS:3.1/MAV:n')).toBeNull();
  });

  it('does not match a MAV that is glued to a preceding token (needs ^ or /)', () => {
    expect(parseMav('CVSS:3.1/XMAV:N')).toBeNull();
  });

  it('does not match when the letter is followed by another letter (needs / or $)', () => {
    expect(parseMav('CVSS:3.1/MAV:NX/AV:N')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseMav(undefined)).toBeNull();
    expect(parseMav(null)).toBeNull();
    expect(parseMav(42)).toBeNull();
    expect(parseMav({})).toBeNull();
    expect(parseMav(['MAV:N'])).toBeNull();
  });
});

describe('#104 toEnvironmentalContext', () => {
  it('maps a fully-populated module', () => {
    const module = {
      _id: 'M1',
      name: 'auth-service',
      projectId: 'P1',
      ciaRequirements: {CR: 'H', IR: 'M', AR: 'L'},
      environmentalConfig: {
        v2vectorString: 'AV:N/AC:L/Au:N/C:P/I:P/A:P',
        v3vectorString: 'CVSS:3.1/AV:N/MAV:A',
        v4vectorString: 'CVSS:4.0/AV:N/MAV:L'
      }
    };
    expect(toEnvironmentalContext(module)).toEqual({
      moduleId: 'M1',
      projectId: 'P1',
      name: 'auth-service',
      ciaRequirements: {CR: 'H', IR: 'M', AR: 'L'},
      environmentalConfig: {
        v2vectorString: 'AV:N/AC:L/Au:N/C:P/I:P/A:P',
        v3vectorString: 'CVSS:3.1/AV:N/MAV:A',
        v4vectorString: 'CVSS:4.0/AV:N/MAV:L'
      },
      mav: 'L' // v4 wins over v3
    });
  });

  it('prefers the v4 MAV over the v3 MAV', () => {
    const module = {
      _id: 'M1',
      environmentalConfig: {
        v3vectorString: 'CVSS:3.1/MAV:A',
        v4vectorString: 'CVSS:4.0/MAV:N'
      }
    };
    expect(toEnvironmentalContext(module).mav).toBe('N');
  });

  it('falls back to the v3 MAV when v4 is absent', () => {
    const module = {_id: 'M1', environmentalConfig: {v3vectorString: 'CVSS:3.1/MAV:P'}};
    expect(toEnvironmentalContext(module).mav).toBe('P');
  });

  it('falls back to the v3 MAV when the v4 MAV is X (not-defined)', () => {
    const module = {
      _id: 'M1',
      environmentalConfig: {
        v3vectorString: 'CVSS:3.1/MAV:A',
        v4vectorString: 'CVSS:4.0/MAV:X'
      }
    };
    expect(toEnvironmentalContext(module).mav).toBe('A');
  });

  it('mav is null when a vector is present but carries no MAV token', () => {
    const module = {_id: 'M1', environmentalConfig: {v3vectorString: 'CVSS:3.1/AV:N/AC:L'}};
    expect(toEnvironmentalContext(module).mav).toBeNull();
  });

  it('NEVER inspects the v2 vector for MAV (v2 has no MAV metric)', () => {
    // even a v2 string that literally contains "MAV:N" must not surface as mav
    const module = {_id: 'M1', environmentalConfig: {v2vectorString: 'MAV:N/AV:N'}};
    const out = toEnvironmentalContext(module);
    expect(out.mav).toBeNull();
    expect(out.environmentalConfig.v2vectorString).toBe('MAV:N/AV:N');
  });

  it('emits environmentalConfig with all three keys null when environmentalConfig is absent', () => {
    const module = {_id: 'M1'};
    expect(toEnvironmentalContext(module).environmentalConfig).toEqual({
      v2vectorString: null,
      v3vectorString: null,
      v4vectorString: null
    });
  });

  it('nulls only the individually-absent vector keys', () => {
    const module = {_id: 'M1', environmentalConfig: {v3vectorString: 'CVSS:3.1/AV:N'}};
    expect(toEnvironmentalContext(module).environmentalConfig).toEqual({
      v2vectorString: null,
      v3vectorString: 'CVSS:3.1/AV:N',
      v4vectorString: null
    });
  });

  it('ciaRequirements is null when the module has none (no X synthesis)', () => {
    const module = {_id: 'M1', environmentalConfig: {v3vectorString: 'CVSS:3.1/AV:N'}};
    expect(toEnvironmentalContext(module).ciaRequirements).toBeNull();
  });

  it('passes stored discrete CR/IR/AR letters through verbatim (incl. X)', () => {
    const module = {_id: 'M1', ciaRequirements: {CR: 'X', IR: 'L', AR: 'H'}};
    expect(toEnvironmentalContext(module).ciaRequirements).toEqual({CR: 'X', IR: 'L', AR: 'H'});
  });

  it('projectId and name default to null when absent', () => {
    const out = toEnvironmentalContext({_id: 'M1'});
    expect(out.projectId).toBeNull();
    expect(out.name).toBeNull();
    expect(out.moduleId).toBe('M1');
  });
});
