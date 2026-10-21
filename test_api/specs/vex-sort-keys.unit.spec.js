/* eslint-disable no-undef */
// Pure unit test for the CSAF/VEX key-sorting helper. vex.js imports meteor/*
// and cannot be required under Jest, so sortKeys lives in a dependency-free
// CommonJS module (imports/lib/converter/sortKeys.js) that vex.js re-exports.
const {sortKeys} = require('../../imports/lib/converter/sortKeys');

describe('sortKeys', () => {
  it('sorts object keys recursively and preserves array order', () => {
    const input = {b: 1, a: {d: 4, c: 3}};
    expect(JSON.stringify(sortKeys(input))).toBe(JSON.stringify({a: {c: 3, d: 4}, b: 1}));
  });

  it('sorts the keys of objects inside arrays', () => {
    const sorted = sortKeys({list: [{uri: 'x', namespace: 'https://z.example'}]});
    expect(Object.keys(sorted.list[0])).toEqual(['namespace', 'uri']);
  });

  it('leaves non-plain objects as they are', () => {
    const date = new Date(0);
    expect(sortKeys({when: date}).when).toBe(date);
  });
});

// vex.js imports meteor/* and cannot be required under Jest, so its wiring is
// locked with a static-source regression.
describe('vex.js wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../imports/lib/converter/vex.js'), 'utf8');

  it('imports sortKeys from the meteor-free helper (no duplicate copy)', () => {
    expect(src).toMatch(/import\s*\{\s*sortKeys\s*\}\s*from\s*'\.\/sortKeys'/);
    expect(src).not.toMatch(/function sortKeys\s*\(/);
  });

  it('re-exports sortKeys from vex.js', () => {
    expect(src).toMatch(/export\s*\{\s*sortKeys\s*\}/);
  });

  it('takes productIds as the 4th param of fromVulnerabilityReport', () => {
    expect(src).toMatch(
      /async function fromVulnerabilityReport\(\{company, project, modules, list\}, confidenceCurrent, createCSAF, productIds\)/);
  });

  it('no longer writes a case reference into document.tracking', () => {
    expect(src).not.toContain('tracking.x_generic_uris');
    expect(src).not.toContain('caseRef');
  });
});
