import {expect} from 'chai';
import {RiskSchema} from './riskSchema';
import {TaskSchema, TASK_STATUS_VALUES} from './taskSchema';

// The REST API stored values the UI cannot show (#58).
describe('risk and task values the API accepts (#58)', function () {
  const base = {companyId: 'Hk6cesvWdoX5Yqbo8', name: 'Test risk'};

  function validRisk(riskProperties) {
    const doc = RiskSchema.clean({...base, riskProperties});
    const context = RiskSchema.newContext();
    context.validate(doc);
    return {doc, valid: context.isValid()};
  }

  function validTask(status) {
    const doc = TaskSchema.clean({companyId: 'Hk6cesvWdoX5Yqbo8', task: 'Patch', status});
    const context = TaskSchema.newContext();
    context.validate(doc);
    return context.isValid();
  }

  it('accepts the task states the Tasks tab knows, and refuses others', function () {
    TASK_STATUS_VALUES.forEach((status) => expect(validTask(status), status).to.equal(true));
    expect(validTask('open')).to.equal(false);
    expect(validTask('Done')).to.equal(false);
  });

  it('stores C/I/A as booleans and refuses other values', function () {
    const {doc, valid} = validRisk({confidentiality: true, integrity: 'false', availability: 'true'});
    expect(valid).to.equal(true);
    expect(doc.riskProperties).to.include({confidentiality: true, integrity: false, availability: true});
    expect(validRisk({confidentiality: 'H'}).valid).to.equal(false);
    expect(validRisk({integrity: 'L'}).valid).to.equal(false);
  });

  it('normalises the case of STRIDE categories and refuses unknown ones', function () {
    const {doc, valid} = validRisk({threatModelContext: {strideCategories: ['information disclosure', 'Spoofing']}});
    expect(valid).to.equal(true);
    expect(doc.riskProperties.threatModelContext.strideCategories).to.deep.equal(['Information Disclosure', 'Spoofing']);
    expect(validRisk({threatModelContext: {strideCategories: ['Phishing']}}).valid).to.equal(false);
  });
});
