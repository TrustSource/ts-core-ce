/* eslint-disable no-undef */
// The first-admin runner: seeds only through the planner, creates the user without
// the sign-up side effects, never logs the password, and never blocks startup.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const runner = live('imports/startup/server/initialAdmin.js');

describe('initial admin runner', () => {
  it('asks the planner with the live user count and the settings', () => {
    expect(runner).toMatch(/planInitialAdmin\(\{/);
    expect(runner).toMatch(/Meteor\.users\.find\(\)\.countAsync\(\)/);
    expect(runner).toMatch(/Config\.INITIAL_ADMIN_EMAIL/);
    expect(runner).toMatch(/Config\.INITIAL_ADMIN_PASSWORD/);
  });

  it('creates the company, the user and the owner roles', () => {
    expect(runner).toMatch(/Companies\.insertAsync\(/);
    expect(runner).toMatch(/Accounts\.createUserAsync\(/);
    expect(runner).toMatch(/Roles\.setUserRolesAsync\([^)]*COMPANY_OWNER_ROLES/);
  });

  it('creates the user inside the trusted company assignment with the fixture marker, then removes the marker', () => {
    expect(runner).toMatch(/trustedCompanyAssignment\.withValue\(true/);
    expect(runner).toMatch(/testuser: true/);
    expect(runner).toMatch(/\$unset: \{'profile\.testuser': ''?1?''?\}|\$unset: \{'profile\.testuser': (1|'')\}/);
  });

  it('never logs the password and never throws out of startup', () => {
    expect(runner).not.toMatch(/console\.\w+\([^)]*[Pp]assword[^)]*Config/);
    expect(runner).not.toMatch(/console\.\w+\([^)]*INITIAL_ADMIN_PASSWORD\b[^'"]/);
    expect(runner).toMatch(/try \{[\s\S]*\} catch \(e\) \{[\s\S]*console\.error/);
  });

  it('removes the company it inserted when the user could not be created', () => {
    expect(runner).toMatch(/companyId = await Companies\.insertAsync\(/);
    const catchStart = runner.indexOf('} catch (e) {');
    expect(catchStart).toBeGreaterThan(-1);
    const handler = runner.slice(catchStart);
    const remove = handler.indexOf('Companies.removeAsync({_id: companyId})');
    expect(remove).toBeGreaterThan(-1);
    expect(handler.indexOf("console.error('=> Initial admin could not be created:'")).toBeGreaterThan(remove);
    // Only when the user was never created: an admin that exists keeps its company.
    expect(handler.slice(0, remove)).toMatch(/if \(companyId && !userId\)/);
  });

  it('is registered after the fixtures', () => {
    const index = live('imports/startup/server/index.js');
    expect(index.indexOf("import './initialAdmin';")).toBeGreaterThan(index.indexOf("import './fixtures';"));
  });

  it('sign-up uses the shared owner role list', () => {
    expect(live('imports/startup/server/accounts.js')).toMatch(/COMPANY_OWNER_ROLES/);
  });
});

describe('initial admin runner (behaviour)', () => {
  const {loadMeteorModule} = require('../helpers/loadMeteorModule');
  const {planInitialAdmin} = require('../../imports/server/initialAdmin/initialAdminPlan');

  function run({insertError, createError, rolesError, removeError} = {}) {
    const events = [];
    let startup;
    const Companies = {
      insertAsync: jest.fn(async () => {
        if (insertError) throw insertError;
        return 'company1';
      }),
      removeAsync: jest.fn(async (selector) => {
        events.push(['remove', selector]);
        if (removeError) throw removeError;
        return 1;
      })
    };
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation((...args) => events.push(['error', args[0]]));
    loadMeteorModule('imports/startup/server/initialAdmin.js', {
      'meteor/meteor': {Meteor: {
        startup: (fn) => { startup = fn; },
        users: {find: () => ({countAsync: async () => 0}), updateAsync: jest.fn(async () => 1)}
      }},
      'meteor/accounts-base': {Accounts: {createUserAsync: jest.fn(async () => {
        if (createError) throw createError;
        return 'user1';
      })}},
      'meteor/alanning:roles': {Roles: {setUserRolesAsync: jest.fn(async () => {
        if (rolesError) throw rolesError;
      })}},
      '/imports/lib/collections/companies': Companies,
      '/imports/server/config': {Config: {INITIAL_ADMIN_EMAIL: 'admin@example.com', INITIAL_ADMIN_PASSWORD: 'correct-horse'}},
      '/imports/startup/server/accounts': {trustedCompanyAssignment: {withValue: (value, fn) => fn()}},
      '/imports/server/initialAdmin/initialAdminPlan': {planInitialAdmin},
      '/imports/server/userRoles': {COMPANY_OWNER_ROLES: ['account_admin']}
    }, {allowNoExports: true});
    return startup().then(() => ({events, Companies}));
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes exactly the inserted company, then logs, when the user cannot be created', async () => {
    const {events} = await run({createError: new Error('Email already exists.')});
    expect(events).toEqual([
      ['remove', {_id: 'company1'}],
      ['error', '=> Initial admin could not be created:']
    ]);
  });

  it('keeps the company once the user exists', async () => {
    const {Companies} = await run({rolesError: new Error('roles down')});
    expect(Companies.removeAsync).not.toHaveBeenCalled();
  });

  it('removes nothing when the company was never inserted', async () => {
    const {Companies} = await run({insertError: new Error('db down')});
    expect(Companies.removeAsync).not.toHaveBeenCalled();
  });

  it('never throws out of startup when the removal fails too', async () => {
    const {events} = await run({createError: new Error('boom'), removeError: new Error('db down')});
    expect(events).toEqual([
      ['remove', {_id: 'company1'}],
      ['error', '=> Initial admin company could not be removed:'],
      ['error', '=> Initial admin could not be created:']
    ]);
  });
});
