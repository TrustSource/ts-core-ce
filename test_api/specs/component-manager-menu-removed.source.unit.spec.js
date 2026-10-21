/* eslint-disable no-undef */
// The sidebar no longer has a "Component mngr." section. Its Manage IC and Manage COTS
// links opened the same pages as Knowledge > Infrastructure Elements and Knowledge >
// 3rd party (COTS), where component managers manage components; Critical Components
// is no longer offered from the menu.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const NAVIGATION = 'imports/client/ui/common/navigation.js';

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

describe('Component mngr. menu section removed', () => {
  const nav = read(NAVIGATION);

  it('has no Component mngr. section or its entries', () => {
    expect(nav).not.toMatch(/id: 'company_component_manager'/);
    expect(nav).not.toMatch(/Component mngr\./);
    expect(nav).not.toMatch(/id: 'infrastructureManagement'/);
    expect(nav).not.toMatch(/id: 'cotsManagement'/);
    expect(nav).not.toMatch(/id: 'criticalComponentsGithub'/);
  });

  it('keeps the Knowledge entries component managers manage from', () => {
    expect(nav).toMatch(/id: 'knowledge'/);
    expect(nav).toMatch(/id: 'infrastructureComponentsList'[\s\S]{0,120}route: 'infrastructureComponentsList'/);
    expect(nav).toMatch(/id: 'cotsComponentsList'[\s\S]{0,120}route: 'cotsComponentsList'/);
  });
});
