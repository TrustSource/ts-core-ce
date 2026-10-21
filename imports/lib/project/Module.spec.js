
import Module from './Module';
import {expect} from 'chai';

const ANOTHER_COMMENT = 'another comment'

describe('Module', function () {

  let module;

  beforeEach(function () {
    module = new Module({
      name: 'testModule',
      companyId: 'XYZdpfffWAWzozSit',
      moduleIdentifier: 'mvn:test-module',
      licenseConfig: {
        whitelist: [{key: 'MIT', comment: 'just added this'}, {key: 'APACHE20', comment: 'this also'}],
        blacklist: [{key: 'Blacklisted', comment: 'a comment'}]
      },
      componentConfig: {
        whitelist: [{key: 'mvn:w1:*', version: '*', comment: 'a comment'},
          {key: 'bower:w2', version: '1.*', comment: ANOTHER_COMMENT}],
        blacklist: [{key: 'mvn:b1:*', version: '*', comment: ANOTHER_COMMENT},
          {key: 'bower:b2', version: '1.*', comment: ANOTHER_COMMENT}],
        unchanged: [{key: 'mvn:b2:*', version: '*', comment: 'another one comment'},
          {key: 'bower:b3', version: '2.*', comment: 'another one comment'}],
        looseCoupled: [{key: 'mvn:2:*', version: '*', comment: 'another second comment'},
          {key: 'bower:b3', version: '3.*', comment: 'another second comment'}]
      },
      properties: {
        architectureType: 'BES'
      },
      viabilityConfig: {
        warningThreshold: 1,
        violationThreshold: 1,
        minConfidence: 1,
        noInfoLevel: 3
      }
    });
  });

  it('empty object should not validate against schema', function () {
    const context = new Module({}).validate();
    expect(context.isValid()).to.be.false;
  });

  it('test object should validate against schema', function () {
    const context = module.validate();
    if (!context.isValid()) {
      console.log('Module invalid:', module.name, 'invalid keys: ', context.validationErrors());
    }
    expect(context.validationErrors()).to.be.deep.equal([]);
  });

  it('3 arguments constructor should create valid component after \'architectureType\' is set', function () {
    const module = new Module('XYZdpfffWAWzozSit', 'moduleName', 'scanId');
    module.properties = {};
    module.properties.architectureType = 'IS';
    const context = module.validate();
    if (!context.isValid()) {
      console.log('Module invalid:', module.name, 'invalid keys: ', context.validationErrors());
    }
    expect(context.validationErrors()).to.be.deep.equal([]);
  });

  describe('isComponentWhitelisted()', function () {
    it('should accept single version', function () {
      // [{key: 'mvn:w1:*', version: '*', comment: 'a comment'},
      //   {key: 'bower:w2', version: '1.*', comment: ANOTHER_COMMENT}],
      expect(!!module.isComponentWhitelisted('xx', ['1.0.15'])).to.be.false;
      expect(!!module.isComponentWhitelisted('mvn:w1:abc', ['1.0.15'])).to.be.true;
    });

    it('should accept version array and all versions have to match', function () {
      expect(!!module.isComponentWhitelisted('bower:w1', ['1.0.1', '1.1.0'])).to.be.false;
      expect(!!module.isComponentWhitelisted('bower:w2', ['1.0.1', '1.1.0', '2.0'])).to.be.false;
      expect(!!module.isComponentWhitelisted('bower:w2', ['1.0.1', '1.1.1', '1.3.4'])).to.be.true;
    });
  });

  describe('isComponentBlacklisted()', function () {
    it('should accept single version', function () {
      expect(!!module.isComponentBlacklisted('mvn:b2:abc', '2.0.15')).to.be.false;
      expect(!!module.isComponentBlacklisted('bower:b2', '1.0.15')).to.be.true;

    });

    it('should accept version array and only one version has to match', function () {
      expect(!!module.isComponentBlacklisted('mvn:a1:abc', ['1.0.1', '1.0.2'])).to.be.false;
      expect(!!module.isComponentBlacklisted('bower:b2', ['0.0.1', '1.1.0', '2.0'])).to.be.true;
      expect(!!module.isComponentBlacklisted('bower:b2', ['1.0.1', '1.1.1', '1.3.4'])).to.be.true;
      expect(!!module.isComponentBlacklisted('bower:b2', ['5.0', '6.0', '1.0'])).to.be.true;
    });
  });

  describe('legalSettingsValid()', function () {
    it('should return false if requirements are undefined', function () {
      const m = new Module({});
      expect(m.legalSettingsValid()).to.be.false;
    });
    it('should return false if requirements are incomplete', function () {
      module.requirements = {
        'D': 'D_ipoa'
      };
      expect(module.legalSettingsValid()).to.be.false;
    });
    it('should return true if requirements are complete', function () {
      module.requirements = {
        'TS': 'TS_y',
        'LS': 'LS_pl',
        'D': 'D_ipoa'
      };
      expect(module.legalSettingsValid()).to.be.true;
    });
  });

  describe('viabilitySettingsValid()', function () {
    it('should return false if viabilitySettings are undefined', function () {
      const m = new Module({});
      expect(m.viabilitySettingsValid()).to.be.false;
    });
    it('should return false if requirements are incomplete', function () {
      module.viabilityConfig = {
        warningThreshold: 0
      };
      expect(module.viabilitySettingsValid()).to.be.false;
    });
    it('should return false if requirements are complete and invalid', function () {
      module.viabilityConfig = {
        warningThreshold: 2,
        violationThreshold: 3,
        minConfidence: 1,
        noInfoLevel: 1
      };
      expect(module.viabilitySettingsValid()).to.be.false;
    });
    it('should return true if requirements are complete and valid', function () {
      module.viabilityConfig = {
        warningThreshold: 2,
        violationThreshold: 2,
        minConfidence: 1,
        noInfoLevel: 1
      };
      expect(module.viabilitySettingsValid()).to.be.true;
      module.viabilityConfig = {
        warningThreshold: 2,
        violationThreshold: 0,
        minConfidence: 1,
        noInfoLevel: 1
      };
      expect(module.viabilitySettingsValid()).to.be.true;
      module.viabilityConfig = {
        warningThreshold: 0,
        violationThreshold: 2,
        minConfidence: 1,
        noInfoLevel: 1
      };
      expect(module.viabilitySettingsValid()).to.be.true;
    });
  })
});
