/* eslint-disable no-undef */
// Outside development the server prints its configuration at startup and masks secrets as
// '****' plus the last characters. For INITIAL_ADMIN_PASSWORD even that tail is too much (it is
// half of an 8-character password), so the logger prints only whether it is set.
//
// Two layers:
//   - source assertions: the special case sits before the generic masking and never cuts the value;
//   - behaviour: the real config module, loaded with a stubbed process.env, and its log lines.
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const CONFIG = 'imports/server/config.js';
const PASSWORD = 'Zq9#Xw7!Vt';

describe('config logger (source)', () => {
  const src = readSourceWithoutComments(CONFIG);

  it('special-cases INITIAL_ADMIN_PASSWORD before the generic masking', () => {
    const special = src.indexOf("key === 'INITIAL_ADMIN_PASSWORD'");
    const generic = src.indexOf("key.indexOf('PASSWORD')");
    expect(special).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(special);
  });

  it('prints only set or unset and never cuts the value in that branch', () => {
    const start = src.indexOf("key === 'INITIAL_ADMIN_PASSWORD'");
    const end = src.indexOf('return;', start);
    expect(end).toBeGreaterThan(start);
    const branch = src.slice(start, end);
    expect(branch).toContain("'set'");
    expect(branch).toContain("'unset'");
    expect(branch).not.toMatch(/\.(substr|slice|substring)\(/);
  });
});

function loadConfig(env) {
  const lines = [];
  jest.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')));
  loadMeteorModule(CONFIG, {
    'dotenv': {config: jest.fn(() => ({}))},
    'path': {resolve: jest.fn(() => '')}
  }, {globals: {process: {cwd: () => '', env: Object.assign({NODE_ENV: 'production'}, env)}}});
  return lines;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('config logger (behaviour)', () => {
  it('prints a set password as "set" and no character of it', () => {
    const lines = loadConfig({INITIAL_ADMIN_PASSWORD: PASSWORD});
    expect(lines.filter((line) => line.includes('INITIAL_ADMIN_PASSWORD'))).toEqual(['=> INITIAL_ADMIN_PASSWORD set']);
    expect(lines.join('\n')).not.toContain(PASSWORD.slice(-4));
    expect(lines.join('\n')).not.toContain('****');
  });

  it.each([
    ['missing', undefined],
    ['empty', '']
  ])('prints a %s password as "unset"', (_label, value) => {
    const lines = loadConfig({INITIAL_ADMIN_PASSWORD: value});
    expect(lines.filter((line) => line.includes('INITIAL_ADMIN_PASSWORD'))).toEqual(['=> INITIAL_ADMIN_PASSWORD unset']);
  });

  it('prints every other key as before', () => {
    const lines = loadConfig({
      INITIAL_ADMIN_PASSWORD: PASSWORD,
      INITIAL_ADMIN_EMAIL: 'admin@example.com',
      MAIL_URL: 'smtp://user:pass@mail.example:587'
    });
    expect(lines).toContain('=> INITIAL_ADMIN_EMAIL admin@example.com');
    expect(lines).toContain('=> MAIL_URL ****mple:587');
    expect(lines).toContain('=> PORT undefined');
  });

  it('prints nothing in development', () => {
    const lines = loadConfig({NODE_ENV: 'development', INITIAL_ADMIN_PASSWORD: PASSWORD});
    expect(lines.join('\n')).not.toContain('INITIAL_ADMIN_PASSWORD');
  });
});
