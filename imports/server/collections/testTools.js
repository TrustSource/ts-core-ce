import {Meteor} from 'meteor/meteor';
import TestTools from '/imports/lib/collections/testTools';
import Tests from '/imports/lib/collections/tests';

// Common SARIF producers, under the driver names their SARIF output carries, so a
// required tool matches the uploads of that tool. Seeded once; nothing else in CE
// writes this collection.
export const DEFAULT_TEST_TOOLS = [
  {name: 'CodeQL', website: 'https://codeql.github.com/'},
  {name: 'Semgrep OSS', website: 'https://semgrep.dev/'},
  {name: 'ESLint', website: 'https://eslint.org/'},
  {name: 'Bandit', website: 'https://bandit.readthedocs.io/'},
  {name: 'Trivy', website: 'https://trivy.dev/'},
  {name: 'Checkov', website: 'https://www.checkov.io/'}
];

// Catalog tools, plus every tool the company's SARIF uploads named that is not in
// the catalog (id 'sarif:<name>'), so the Quality settings can require it.
Meteor.publish('testTools', async function () {
  const user = this.userId && await Meteor.users.findOneAsync(this.userId, {fields: {profile: 1}});
  if (!user) {
    return this.ready();
  }
  const catalog = await TestTools.find().fetchAsync();
  catalog.forEach((tool) => this.added('testTools', tool._id, tool));
  const companyId = user.profile && user.profile.companyId;
  if (companyId) {
    const known = new Set(catalog.map((tool) => tool.name));
    const seen = await Tests.rawCollection().distinct('tool', {companyId, type: 'SARIF'});
    seen.filter((name) => typeof name === 'string' && name && !known.has(name)).forEach((name) => {
      this.added('testTools', 'sarif:' + name, {name});
    });
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
TestTools.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

export async function seedTestTools() {
  for (const tool of DEFAULT_TEST_TOOLS) {
    if (!await TestTools.findOneAsync({name: tool.name}, {fields: {_id: 1}})) {
      await TestTools.insertAsync(Object.assign({allowThreshold: false}, tool));
    }
  }
}

Meteor.startup(async function () {
  try {
    await seedTestTools();
  } catch (error) {
    console.log('=> Test tools could not be seeded:', error && error.message);
  }
});
