import {expect} from 'chai';
import TestTools from '/imports/lib/collections/testTools';
import {seedTestTools, DEFAULT_TEST_TOOLS} from './testTools';

// The Quality settings Tool selector read an empty collection (#63).
describe('test tools (#63)', function () {
  afterEach(async function () {
    await TestTools.removeAsync({name: {$in: DEFAULT_TEST_TOOLS.map((tool) => tool.name)}});
  });

  it('seeds the common SARIF tools once', async function () {
    await seedTestTools();
    await seedTestTools();
    const names = (await TestTools.find({}, {fields: {name: 1}}).fetchAsync()).map((tool) => tool.name);
    DEFAULT_TEST_TOOLS.forEach((tool) => {
      expect(names.filter((name) => name === tool.name)).to.have.length(1);
    });
  });
});
