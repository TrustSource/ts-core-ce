import {RiskSchema, CountermeasureSchema, RISK_STATE_VALUES, COUNTERMEASURE_STATUS_VALUES, RISK_ORIGIN_VALUES} from './riskSchema';
import {expect} from 'chai';

describe('RiskSchema', function () {
  const base = {
    companyId: 'Hk6cesvWdoX5Yqbo8',
    name: 'Test risk'
  };

  it('accepts the extended state values', function () {
    ['transferred', 'eliminated', 'out-of-scope'].forEach(function (state) {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {state}});
      expect(context.isValid(), 'state: ' + state).to.be.true;
    });
  });

  it('rejects an unknown state value', function () {
    const context = RiskSchema.newContext();
    context.validate({...base, riskProperties: {state: 'bogus'}});
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('riskProperties.state')).to.be.true;
  });

  it('accepts a blank state after clean()', function () {
    const doc = RiskSchema.clean({...base, riskProperties: {state: ''}});
    const context = RiskSchema.newContext();
    context.validate(doc);
    expect(context.isValid()).to.be.true;
  });

  it('accepts the extended countermeasure status values', function () {
    ['required', 'not-required', 'verified'].forEach(function (status) {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {
        countermeasures: [{countermeasure: 'patch the library', status}]
      }});
      expect(context.isValid(), 'status: ' + status).to.be.true;
    });
  });

  it('rejects an unknown countermeasure status', function () {
    const context = RiskSchema.newContext();
    context.validate({...base, riskProperties: {
      countermeasures: [{countermeasure: 'patch the library', status: 'bogus'}]
    }});
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('riskProperties.countermeasures.0.status')).to.be.true;
  });

  it('accepts the new countermeasure fields incl. riskReduction 0', function () {
    const context = RiskSchema.newContext();
    context.validate({...base, riskProperties: {
      countermeasures: [{
        countermeasure: 'Use parameterised queries for all DB access',
        status: 'required',
        riskReduction: 0,
        standardRef: 'OWASP-ASVS V5.3.4',
        validationMethod: 'test-suite: tests/security/sqli_test.py',
        otmMitigationId: 'm-prepared-statements'
      }]
    }});
    expect(context.isValid()).to.be.true;
  });

  it('rejects riskReduction outside 0-100', function () {
    [-1, 150].forEach(function (riskReduction) {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {
        countermeasures: [{countermeasure: 'patch the library', riskReduction}]
      }});
      expect(context.isValid(), 'riskReduction: ' + riskReduction).to.be.false;
    });
  });

  it('accepts a full threatModelContext incl. trustBoundaryCrossing false', function () {
    const context = RiskSchema.newContext();
    context.validate({...base, riskProperties: {
      threatModelContext: {
        strideCategories: ['Tampering', 'Elevation of Privilege'],
        enisaCategory: 'Nefarious activity / Abuse',
        enisaThreat: 'Web-application / injection attacks (SQLi, XSS)',
        cwes: ['CWE-89', 'CWE-79'],
        affectedElementType: 'process',
        trustBoundaryCrossing: false,
        tmRunId: 'tm-run-2026-06-04-001',
        tmMethod: 'STRIDE-per-Element',
        otmThreatId: 't-sqli-login'
      }
    }});
    expect(context.isValid()).to.be.true;
  });

  it('rejects unknown keys inside threatModelContext', function () {
    const context = RiskSchema.newContext();
    context.validate({...base, riskProperties: {
      threatModelContext: {nope: 'x'}
    }});
    expect(context.isValid()).to.be.false;
  });

  it('exports enum lists that include the blank UI option', function () {
    expect(RISK_STATE_VALUES).to.include('');
    expect(RISK_STATE_VALUES).to.include('out-of-scope');
    expect(COUNTERMEASURE_STATUS_VALUES).to.include('');
    expect(COUNTERMEASURE_STATUS_VALUES).to.include('not-required');
  });

  it('accepts a countermeasure with a generated _id', function () {
    const context = RiskSchema.newContext();
    context.validate({...base, riskProperties: {countermeasures: [{
      _id: 'Hk6cesvWdoX5Yqbo8',
      countermeasure: 'Upgrade to patched version'
    }]}});
    expect(context.isValid()).to.be.true;
  });

  it('accepts a countermeasure without _id (legacy entries)', function () {
    const context = RiskSchema.newContext();
    context.validate({...base, riskProperties: {countermeasures: [{
      countermeasure: 'Upgrade to patched version'
    }]}});
    expect(context.isValid()).to.be.true;
  });

  it('rejects a countermeasure _id that is not a Mongo id', function () {
    const context = RiskSchema.newContext();
    context.validate({...base, riskProperties: {countermeasures: [{
      _id: 'not a mongo id!',
      countermeasure: 'Upgrade to patched version'
    }]}});
    expect(context.isValid()).to.be.false;
  });

  describe('origin (element-level allowedValues)', function () {
    it('accepts a single legacy origin', function () {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {origin: ['CVE']}});
      expect(context.isValid()).to.be.true;
    });

    it('accepts TMA Assessment', function () {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {origin: ['TMA Assessment']}});
      expect(context.isValid()).to.be.true;
    });

    it('accepts the legacy threat-model value (back-compat)', function () {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {origin: ['threat-model']}});
      expect(context.isValid()).to.be.true;
    });

    it('accepts a multi-value origin array (each element checked)', function () {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {origin: ['CVE', 'TMA Assessment']}});
      expect(context.isValid()).to.be.true;
    });

    it('accepts every canonical non-blank origin value individually', function () {
      RISK_ORIGIN_VALUES.filter(v => v !== '').forEach(function (value) {
        const context = RiskSchema.newContext();
        context.validate({...base, riskProperties: {origin: [value]}});
        expect(context.isValid(), 'origin: ' + value).to.be.true;
      });
    });

    it('rejects an unknown origin and flags the bad element key', function () {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {origin: ['BOGUS']}});
      expect(context.isValid()).to.be.false;
      // Element-level proof: the invalid key is the array element, not the array.
      expect(context.keyIsInvalid('riskProperties.origin.0')).to.be.true;
    });

    it('rejects a bad element in an otherwise valid array', function () {
      const context = RiskSchema.newContext();
      context.validate({...base, riskProperties: {origin: ['CVE', 'BOGUS']}});
      expect(context.isValid()).to.be.false;
      // The good element at index 0 passes; the bad element at index 1 is flagged.
      expect(context.keyIsInvalid('riskProperties.origin.1')).to.be.true;
    });
  });

  it('exports CountermeasureSchema for standalone validation', function () {
    const context = CountermeasureSchema.newContext();
    context.validate({_id: 'Hk6cesvWdoX5Yqbo8', countermeasure: 'Upgrade to patched version', status: 'planned'});
    expect(context.isValid()).to.be.true;
  });
});
