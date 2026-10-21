/* eslint-disable no-undef */
// Integration credentials (Jira password, TFS and GitHub tokens) are decrypted on the server
// for the caller's own company only. A project is read by a plain string id inside the
// caller's company, so a selector object such as {'jira.active': true} or another company's
// project id finds nothing, and no DDP method hands the decrypted values to a client (the
// `.exists?` methods answer with a boolean).
//
// Two layers:
//   - source assertions on the three getters, on the method registrations, and on the Jira
//     and TFS actions awaiting the (async) getters;
//   - behaviour: the real getters, loaded with stubbed Meteor, Companies and Projects.
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const GETTERS = {
  jira: 'imports/lib/interactors/projects/getJiraCredentials.js',
  tfs: 'imports/lib/interactors/projects/getTfsCredentials.js',
  github: 'imports/lib/interactors/projects/getGithubCredentials.js'
};

describe('integration credential getters (source)', () => {
  it.each(Object.values(GETTERS))('%s reads the project only by a string id inside the caller company', (rel) => {
    const src = readSourceWithoutComments(rel);
    expect(src).toContain("typeof projectId === 'string'");
    expect(src).toContain('findOneAsync({_id: projectId, companyId}');
    expect(src).not.toMatch(/findOneAsync\(\s*projectId/);
  });
});

describe('credential methods (source)', () => {
  const methods = readSourceWithoutComments('imports/startup/server/project.js');

  it.each(['Projects.GetTfsCredentials', 'Projects.GetJiraCredentials', 'Projects.GetGithubCredentials'])(
    'does not register %s, which would return decrypted credentials', (name) => {
      expect(methods).not.toContain(`'${name}':`);
    });

  it.each(['Projects.GetTfsCredentials', 'Projects.GetJiraCredentials', 'Projects.GetGithubCredentials'])(
    'keeps the boolean %s.exists? check', (name) => {
      expect(methods).toContain(`'${name}.exists?': async function`);
    });
});

describe('Jira and TFS actions await their credentials (source)', () => {
  it.each([
    ['imports/startup/server/jira.js', 'ProjectsGetJiraCredentials'],
    ['imports/startup/server/tfs.js', 'ProjectsGetTfsCredentials']
  ])('%s never destructures the %s promise', (rel, getter) => {
    const src = readSourceWithoutComments(rel);
    const calls = src.match(new RegExp('=\\s*(await\\s+)?' + getter + '\\(', 'g')) || [];
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((call) => expect(call).toMatch(/await/));
  });

  it('jira.js awaits getApiParams at every call site', () => {
    const src = readSourceWithoutComments('imports/startup/server/jira.js');
    expect(src).toMatch(/async function getApiParams\(/);
    const calls = src.match(/=\s*(await\s+)?getApiParams\(/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((call) => expect(call).toMatch(/await/));
  });
});

const SECRETS = {
  jira: {company: {jira: {active: true, url: 'https://a.example', user: 'u', passwd: 'enc:company', key: 'A', type: 'basic'}},
    project: {jira: {active: true, url: 'https://p.example', passwd: 'enc:project', key: 'P'}},
    secret: 'passwd', fields: {jira: 1}},
  tfs: {company: {tfs: {active: true, account: 'acme', project: 'core', token: 'enc:company'}},
    project: {tfs: {active: true, account: 'acme-p', token: 'enc:project'}},
    secret: 'token', fields: {tfs: 1}},
  github: {company: {github: {active: true, token: 'enc:company'}},
    project: {github: {active: true, token: 'enc:project'}},
    secret: 'token', fields: {github: 1}}
};

function load(kind, {user = {_id: 'u1', profile: {companyId: 'companyA'}}} = {}) {
  const Companies = {findOneAsync: jest.fn(async () => JSON.parse(JSON.stringify(SECRETS[kind].company)))};
  const Projects = {findOneAsync: jest.fn(async () => JSON.parse(JSON.stringify(SECRETS[kind].project)))};
  const removeEmpty = (object) => {
    const out = {};
    Object.keys(object).forEach((key) => {
      if (object[key] !== undefined && object[key] !== null && object[key] !== '') out[key] = object[key];
    });
    return out;
  };
  const mod = loadMeteorModule(GETTERS[kind], {
    'meteor/meteor': {Meteor: {userAsync: jest.fn(async () => user)}},
    'underscore': {extend: (target, source) => Object.assign(target, source)},
    '/imports/lib/collections/companies': Companies,
    '/imports/lib/collections/projects': Projects,
    '/imports/lib/utils': {removeEmpty},
    '/imports/lib/crypto': {decrypt: (value) => value.replace(/^enc:/, 'plain:')}
  });
  return {get: mod.default, Companies, Projects};
}

describe.each(Object.keys(GETTERS))('%s credentials (behaviour)', (kind) => {
  const secret = SECRETS[kind].secret;

  it('looks the project up by id inside the caller company', async () => {
    const {get, Projects} = load(kind);
    const settings = await get('project1');
    expect(Projects.findOneAsync).toHaveBeenCalledWith({_id: 'project1', companyId: 'companyA'}, {fields: SECRETS[kind].fields});
    expect(settings[secret]).toBe('plain:project');
    expect(settings.companyId).toBe('companyA');
  });

  it.each([
    ['a selector object', {[kind + '.active']: true}],
    ['an operator object', {$ne: null}],
    ['an empty string', ''],
    ['no project id', undefined]
  ])('never looks up a project for %s', async (_label, projectId) => {
    const {get, Projects} = load(kind);
    const settings = await get(projectId);
    expect(Projects.findOneAsync).not.toHaveBeenCalled();
    expect(settings[secret]).toBe('plain:company');
  });

  it.each([
    ['no logged-in user', null],
    ['a user without a company', {_id: 'u1', profile: {}}]
  ])('returns {} without any lookup for %s', async (_label, user) => {
    const {get, Companies, Projects} = load(kind, {user});
    await expect(get('project1')).resolves.toEqual({});
    expect(Companies.findOneAsync).not.toHaveBeenCalled();
    expect(Projects.findOneAsync).not.toHaveBeenCalled();
  });
});
