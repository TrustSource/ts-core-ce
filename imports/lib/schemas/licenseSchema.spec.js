
import {LicenseSchema} from './licenseSchema';
import {expect} from 'chai';

describe('LicenseSchema', function () {
  it('should detect invalid url', function () {
    const obj = {
      key: 'key',
      name: 'name',
      url: 'abcde',
      created: new Date(),
      updated: new Date()
    };

    const context = LicenseSchema.newContext();
    context.validate(obj);

    expect(context.isValid()).to.be.false;
    expect(context.validationErrors().length).be.equal(1);
    expect(context.keyIsInvalid('url')).to.be.true;
    expect(context.validationErrors()[0].type).to.be.equal('regEx');
  });
});
