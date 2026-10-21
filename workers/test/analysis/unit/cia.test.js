import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCiaRequirements } from '../../../analysis/services/cia.js';

// #52: a module value replaced the project's even when lower, and the merge
// mutated the project object.
describe('mergeCiaRequirements', () => {
  it('keeps the higher value per field', () => {
    const project = {CR: 'H', IR: 'M', AR: 'L'};
    const module = {CR: 'L', IR: 'H', AR: 'X'};
    assert.deepEqual(mergeCiaRequirements(project, module), {CR: 'H', IR: 'H', AR: 'L'});
  });

  it('does not change either input', () => {
    const project = {CR: 'H', IR: 'M', AR: 'L'};
    const module = {CR: 'L'};
    mergeCiaRequirements(project, module);
    assert.deepEqual(project, {CR: 'H', IR: 'M', AR: 'L'});
    assert.deepEqual(module, {CR: 'L'});
  });

  it('takes whichever side defines a field', () => {
    assert.deepEqual(mergeCiaRequirements({CR: 'M'}, {IR: 'L'}), {CR: 'M', IR: 'L'});
    assert.deepEqual(mergeCiaRequirements(undefined, {CR: 'L'}), {CR: 'L'});
    assert.deepEqual(mergeCiaRequirements({AR: 'H'}, undefined), {AR: 'H'});
    assert.equal(mergeCiaRequirements(undefined, undefined), undefined);
  });
});
