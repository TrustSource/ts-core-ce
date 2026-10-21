/* eslint-disable no-undef */
// TS_ALLOWED_PRIVATE_HOSTS lets a self-hosted installation reach integrations on
// its internal network (on-premises Jira, internal webhook receivers) while every
// other internal address, and cloud metadata always, stays blocked.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn()
}));
const dns = require('node:dns/promises');
const {assertSafePublicUrl, assertSafeEgressUrl} = require('../../imports/lib/security/ssrfGuard');

describe('ssrfGuard private host allowlist', () => {
  const saved = process.env.TS_ALLOWED_PRIVATE_HOSTS;
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TS_ALLOWED_PRIVATE_HOSTS;
    } else {
      process.env.TS_ALLOWED_PRIVATE_HOSTS = saved;
    }
    dns.lookup.mockReset();
  });

  it('blocks internal addresses when nothing is listed', async () => {
    delete process.env.TS_ALLOWED_PRIVATE_HOSTS;
    expect(() => assertSafePublicUrl('http://10.20.0.5/')).toThrow();
    dns.lookup.mockResolvedValue([{address: '10.20.0.5', family: 4}]);
    await expect(assertSafeEgressUrl('https://jira.corp.local/')).rejects.toThrow();
  });

  it('allows a listed IP range as a literal and as a resolved address', async () => {
    process.env.TS_ALLOWED_PRIVATE_HOSTS = '10.20.0.0/16, 192.168.1.10';
    expect(() => assertSafePublicUrl('http://10.20.0.5:8080/')).not.toThrow();
    expect(() => assertSafePublicUrl('http://192.168.1.10/')).not.toThrow();
    expect(() => assertSafePublicUrl('http://10.21.0.5/')).toThrow();
    expect(() => assertSafePublicUrl('http://192.168.1.11/')).toThrow();
    dns.lookup.mockResolvedValue([{address: '10.20.3.4', family: 4}]);
    await expect(assertSafeEgressUrl('https://jira.corp.local/')).resolves.toBeTruthy();
    dns.lookup.mockResolvedValue([{address: '10.20.3.4', family: 4}, {address: '127.0.0.1', family: 4}]);
    await expect(assertSafeEgressUrl('https://jira.corp.local/')).rejects.toThrow();
  });

  it('allows a listed host name or domain suffix to resolve internally', async () => {
    process.env.TS_ALLOWED_PRIVATE_HOSTS = 'jira.corp.local,.hooks.internal';
    dns.lookup.mockResolvedValue([{address: '10.0.0.7', family: 4}]);
    await expect(assertSafeEgressUrl('https://jira.corp.local/rest')).resolves.toBeTruthy();
    await expect(assertSafeEgressUrl('https://a.hooks.internal/')).resolves.toBeTruthy();
    await expect(assertSafeEgressUrl('https://other.corp.local/')).rejects.toThrow();
  });

  it('never allows cloud metadata addresses', async () => {
    process.env.TS_ALLOWED_PRIVATE_HOSTS = '169.254.0.0/16,meta.corp.local';
    expect(() => assertSafePublicUrl('http://169.254.169.254/')).toThrow();
    dns.lookup.mockResolvedValue([{address: '169.254.169.254', family: 4}]);
    await expect(assertSafeEgressUrl('http://meta.corp.local/')).rejects.toThrow();
    dns.lookup.mockResolvedValue([{address: '::ffff:a9fe:a9fe', family: 6}]);
    await expect(assertSafeEgressUrl('http://meta.corp.local/')).rejects.toThrow();
  });

  it('ignores entries it cannot parse', () => {
    process.env.TS_ALLOWED_PRIVATE_HOSTS = '10.0.0.0/99,not a host,*';
    expect(() => assertSafePublicUrl('http://10.0.0.1/')).toThrow();
  });
});
