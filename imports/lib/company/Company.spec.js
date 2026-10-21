
import Company from './Company';
import {expect} from 'chai';

// A valid Meteor id (matches SimpleSchema.RegEx.Id) so the required `_id` passes.
const VALID_ID = 'bwat59Bn6cneY7SRi';

describe('Company', function () {

  let company;

  beforeEach(function () {
    // The Companies collection transform is `new Company(doc)`, so constructing the
    // instance directly is equivalent to `Companies.findOne(id)` for the purpose of
    // these validation tests - and avoids a DB round trip that server-side Meteor 3
    // (async-only Mongo) would otherwise force, keeping the test deterministic on
    // both client and server.
    company = new Company({
      _id: VALID_ID,
      name: 'testCompany',
      created: new Date()
    });
  });

  it('empty object should not validate against Schema', function () {
    expect(new Company({}).validate().isValid()).to.be.false;
  });

  it('the test object should validate against Schema', function () {
    // simple-schema v2 replaced context.invalidKeys() with context.validationErrors().
    expect(company.validate().validationErrors()).to.be.deep.equal([]);
  });
});
