/* eslint-disable no-undef */
const writer = require('../../imports/lib/cyclonedx/writer');
const {validateCycloneDX} = require('../helpers/cyclonedxValidate');

describe('cyclonedx/writer.merge', () => {
  const sboms = [
    {
      components: [
        {'bom-ref': 'pkg:npm/a@1.0.0', name: 'a', version: '1.0.0', purl: 'pkg:npm/a@1.0.0', type: 'library'},
        {'bom-ref': 'pkg:npm/b@2.0.0', name: 'b', version: '2.0.0', purl: 'pkg:npm/b@2.0.0', type: 'library'}
      ],
      dependencies: [{ref: 'pkg:npm/a@1.0.0', dependsOn: ['pkg:npm/b@2.0.0']}]
    },
    {
      components: [
        {'bom-ref': 'pkg:npm/a@1.0.0', name: 'a', version: '1.0.0', purl: 'pkg:npm/a@1.0.0', type: 'library'}
      ],
      dependencies: []
    }
  ];

  it('dedups components, emits 1.7, validates against schema', () => {
    const doc = writer.merge(sboms);
    expect(doc.specVersion).toBe('1.7');
    expect(doc.components.filter((c) => c.name === 'a').length).toBe(1);
    expect(doc.components.length).toBe(2);
    expect(doc.dependencies[0]).toEqual({ref: 'pkg:npm/a@1.0.0', dependsOn: ['pkg:npm/b@2.0.0']});
    expect(validateCycloneDX(doc)).toEqual([]);
  });

  it('handles empty input', () => {
    const doc = writer.merge([]);
    expect(doc.specVersion).toBe('1.7');
    expect(doc.components).toEqual([]);
    expect(validateCycloneDX(doc)).toEqual([]);
  });
});
