/* eslint-disable no-undef */
// Jira-method-level SSRF coverage for the egress contract in
// imports/startup/server/jira.js.
//
// Acceptance criterion: jiraGetIssue / jiraGetMeta / jiraGetIssueList must NOT
// be able to read an internal HTTP response. In production each of these:
//   1. builds httpCall options via getApiParams(), which sets
//      `validateEgress: true` (the Jira base URL is user-supplied), and
//   2. wraps `await httpCall(...)` in a try/catch whose catch returns `false`
//      (the safe failure value) - so an SSRF_BLOCKED throw never surfaces an
//      internal body to the client.
//
// HARNESS NOTE: the real Meteor methods cannot run under Jest - jira.js imports
// `meteor/meteor`, ProjectsGetJiraCredentials, requireProjectAccess and
// registers via Meteor.methods, none of which exist in this node test
// environment. (A Meteor mocha harness would be required and is unavailable
// here.) So we exercise the SHARED EGRESS PATH the methods actually depend on -
// the real httpCall(..., {validateEgress:true}) against a real assertSafeEgressUrl
// with mocked DNS - and replicate the method's exact try/catch-returns-false
// wrapper. This proves the end-to-end safety property (no internal body reaches
// the caller) using the production code under test, not a mock of it. If the
// methods' wiring (validateEgress flag or the catch) regresses, this contract
// must be re-checked.

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn()
}));
const dns = require('node:dns/promises');
const {httpCall} = require('../../imports/lib/httpFetch');

function makeResponse({status = 200, headers = {}, body = ''} = {}) {
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Found',
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => (name.toLowerCase() in lower ? lower[name.toLowerCase()] : null),
      forEach: (cb) => Object.keys(lower).forEach((k) => cb(lower[k], k))
    },
    text: async () => body,
    arrayBuffer: async () => Buffer.from(body)
  };
}

// Mirrors getApiParams() in jira.js for the non-email credential type: the
// options object always carries validateEgress:true. The base URL is the
// attacker-controllable company/project Jira setting.
function jiraOptions() {
  return {
    headers: {'Content-Type': 'application/json'},
    auth: 'user:passwd',
    validateEgress: true
  };
}

// Faithful reproduction of the GET-method body shared by jiraGetIssue /
// jiraGetMeta / jiraGetIssueList: try httpCall, on any throw return false.
async function jiraReadLikeMethod(fullUrl) {
  try {
    return await httpCall('GET', fullUrl, jiraOptions());
  } catch (e) {
    // jira.js logs e and returns false here.
    return false;
  }
}

beforeEach(() => {
  dns.lookup.mockReset();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('jira read methods - internal target via user-supplied base URL', () => {
  it('jiraGetIssue-shape cannot read a literal internal Jira host (returns false, no fetch)', async () => {
    // Jira base URL configured to a literal internal address.
    const base = 'http://10.0.0.5/rest/api/2/';
    const result = await jiraReadLikeMethod(base + 'issue/ECST-1');
    expect(result).toBe(false);
    // Egress guard refused the literal internal IP before any network I/O.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('jiraGetMeta-shape cannot read a metadata endpoint via DNS-rebinding (returns false)', async () => {
    // Public-looking Jira host that resolves to cloud metadata.
    dns.lookup.mockResolvedValue([{address: '169.254.169.254', family: 4}]);
    const base = 'https://evil-jira.attacker.test/rest/api/2/';
    const result = await jiraReadLikeMethod(base + 'issue/createmeta?projectKeys=KEY');
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('jiraGetIssueList-shape cannot follow a redirect into an internal host', async () => {
    // Public Jira host, but the first response 302-redirects to an internal IP.
    dns.lookup.mockImplementation(async (host) => {
      if (host === 'jira.example.test') return [{address: '93.184.216.34', family: 4}];
      throw new Error('unexpected host ' + host);
    });
    global.fetch.mockResolvedValueOnce(makeResponse({
      status: 302,
      headers: {Location: 'http://169.254.169.254/latest/meta-data/'},
      body: ''
    }));
    const base = 'https://jira.example.test/rest/api/2/';
    const result = await jiraReadLikeMethod(base + 'search?jql=project%20%3D%20KEY');
    expect(result).toBe(false);
    // Only the first (public) hop was fetched; the internal hop was refused
    // pre-fetch, so no internal body was ever read.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('no internal response body or IP leaks into the returned value on block', async () => {
    dns.lookup.mockResolvedValue([{address: '10.0.0.5', family: 4}]);
    const base = 'https://internal-jira.attacker.test/rest/api/2/';
    const result = await jiraReadLikeMethod(base + 'issue/ECST-1');
    // The safe failure value is a bare boolean - it carries no body/IP/oracle.
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });

  it('a genuinely public Jira host still works (httpCall returns the body)', async () => {
    dns.lookup.mockResolvedValue([{address: '104.192.143.1', family: 4}]); // Atlassian-ish public
    global.fetch.mockResolvedValueOnce(makeResponse({
      status: 200,
      headers: {'content-type': 'application/json'},
      body: '{"key":"ECST-1"}'
    }));
    const base = 'https://acme.atlassian.net/rest/api/2/';
    const result = await jiraReadLikeMethod(base + 'issue/ECST-1');
    expect(result).not.toBe(false);
    expect(result.statusCode).toBe(200);
    expect(result.data).toEqual({key: 'ECST-1'});
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
