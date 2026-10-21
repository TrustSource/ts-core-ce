
import _ from 'underscore';
import {ModuleSchema} from './moduleSchema';
import {expect} from 'chai';

describe('ModuleSchema', function () {
  it('should report invalidKeys on validation', function () {

    const obj = {};

    const context = ModuleSchema.newContext();
    context.validate(obj);

    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('name')).to.be.true;
  });

  it('should validate optional fields if available', function () {
    const descr = new Array(2000 + 2).join('x'); // 1001 chars
    const obj = {
      name: 'My simple Module',
      description: descr
    };

    const context = ModuleSchema.newContext();
    context.validate(obj);

    expect(descr.length).to.be.equal(2001);
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('description')).to.be.true;
    expect(_.findWhere(context.validationErrors(), {name: 'description'}).type).to.be.equal('maxString');
  });

  it('should detect superflous fields', function () {
    const obj = {
      name: 'My simple Module',
      test: '12345'
    };

    const context = ModuleSchema.newContext();
    context.validate(obj);
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('test')).to.be.true;
    expect(_.findWhere(context.validationErrors(), {name: 'test'}).type).to.be.equal('keyNotInSchema');
  });
});
