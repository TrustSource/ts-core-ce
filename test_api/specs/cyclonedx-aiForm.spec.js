/* eslint-disable no-undef */
const {buildAiModelPayload} = require('../../imports/lib/cyclonedx/aiForm');

describe('cyclonedx/aiForm.buildAiModelPayload', () => {
  it('builds an AI artifact payload from flat form values, keeping only allowed keys', () => {
    const payload = buildAiModelPayload({
      provider: 'OpenAI', task: 'text-generation', modelFamily: 'transformer',
      architecture: 'GPT', version: '1.0', purl: 'pkg:huggingface/gpt@1.0',
      // empty values dropped:
      license: '',
      // foreign key must be ignored:
      subjectName: 'should-not-appear'
    });
    expect(payload.assetType).toBe('machine-learning-model');
    expect(payload.provider).toBe('OpenAI');
    expect(payload.task).toBe('text-generation');
    expect(payload.modelFamily).toBe('transformer');
    expect(payload.architecture).toBe('GPT');
    expect(payload.version).toBe('1.0');
    expect(payload.purl).toBe('pkg:huggingface/gpt@1.0');
    expect(payload).not.toHaveProperty('subjectName');
    expect(payload).not.toHaveProperty('license');
  });

  it('preserves a raw modelCard passthrough verbatim', () => {
    const modelCard = {modelParameters: {task: 'classification'}, considerations: {ethicalConsiderations: [{name: 'bias'}]}};
    const payload = buildAiModelPayload({provider: 'Acme', modelCard});
    expect(payload.modelCard).toEqual(modelCard);
    expect(payload.provider).toBe('Acme');
  });

  it('ignores a non-object modelCard', () => {
    const payload = buildAiModelPayload({modelCard: 'not-an-object'});
    expect(payload).not.toHaveProperty('modelCard');
  });
});
