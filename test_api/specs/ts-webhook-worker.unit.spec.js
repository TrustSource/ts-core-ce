/* eslint-disable no-undef */
// tsWebhook (imports/startup/server/ts-webhook.js) resolves the receivers itself -
// the lookup the ts-webhook Lambda used to run - drops every target that fails the
// egress check, and hands the rest to the webhook worker. It never throws.
const dns = require('dns');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
const {fakeSsrfGuard} = require('../helpers/fakeSsrfGuard');

// What the fake resolver answers. Anything missing is a failed lookup.
const HOSTS = {
  'hooks.example.com': ['93.184.216.34'],
  'localhost': ['127.0.0.1', '::1'],
  'intranet.example.com': ['10.0.0.7'],
  'split.example.com': ['93.184.216.35', '192.168.1.20']
};

function loadTsWebhook(options) {
  const opts = options || {};
  const calls = {find: [], worker: []};
  const guard = fakeSsrfGuard(opts.hosts || HOSTS);
  const module = loadMeteorModule('imports/startup/server/ts-webhook.js', {
    '/imports/lib/collections/webhooks': {default: {
      find: function (selector, findOptions) {
        calls.find.push({selector: selector, options: findOptions});
        return {fetchAsync: async function () {
          if (opts.findError) {
            throw opts.findError;
          }
          return opts.rows || [];
        }};
      }
    }},
    '/imports/server/config': {Config: {DEBUG_MODE_ENABLED: false}},
    // The real guard with a fake resolver: the egress decision is part of what is under
    // test, a DNS query is not.
    '/imports/lib/security/ssrfGuard': guard,
    // Rows in these specs are plaintext; decryption is covered in the Meteor spec.
    '/imports/server/security/webhookSecrets': {openWebhookRow: function (row) { return row; }},
    '/imports/server/workerRunner': {runWorker: async function (service, input) {
      calls.worker.push({service: service, input: input});
      if (opts.workerError) {
        throw opts.workerError;
      }
      return input.targets.map(function () { return {status: 200, data: 'ok'}; });
    }}
  });
  return {tsWebhook: module.tsWebhook, calls: calls, lookups: guard.lookups};
}

// Runs fn with console.info captured; answers the joined log lines.
async function capturingInfo(fn) {
  const logged = [];
  const original = console.info;
  console.info = function () {
    logged.push(Array.prototype.slice.call(arguments).join(' '));
  };
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return logged.join(' | ');
}

const GOOD = {_id: 'wh-good', type: 'slack', url: 'https://hooks.example.com/services/x'};
const GOOD_PINNED = Object.assign({}, GOOD, {resolvedAddresses: ['93.184.216.34']});
const META = {_id: 'wh-meta', type: 'webhook', url: 'http://169.254.169.254/latest/meta-data/'};

describe('tsWebhook', () => {
  // No unit spec may reach the system resolver: fail loudly if anything tries.
  let resolverSpies;
  beforeEach(() => {
    resolverSpies = [
      jest.spyOn(dns, 'lookup').mockImplementation(() => { throw new Error('real DNS in a unit spec'); }),
      jest.spyOn(dns.promises, 'lookup').mockImplementation(() => { throw new Error('real DNS in a unit spec'); })
    ];
  });

  afterEach(() => {
    resolverSpies.forEach((spy) => {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it('answers 400 without data, before any lookup', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD]});

    const result = await tsWebhook({companyId: 'c1', trigger: 'approval'});

    expect(result).toEqual({errorMessage: '400 [data] are required for function execution'});
    expect(calls.find).toHaveLength(0);
    expect(calls.worker).toHaveLength(0);
  });

  it('answers 400 when there are no rows and no tenant or trigger to look them up by', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD]});

    expect(await tsWebhook({trigger: 'approval', data: {a: 1}}))
      .toEqual({errorMessage: '400 [companyId, trigger] are required for function execution'});
    expect(await tsWebhook({companyId: 'c1', data: {a: 1}}))
      .toEqual({errorMessage: '400 [companyId, trigger] are required for function execution'});
    expect(calls.find).toHaveLength(0);
  });

  it('answers 400 without querying when companyId is an operator object, not a string',
    async () => {
      const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD]});

      // A client-controlled companyId must be type-checked, not truthiness-checked:
      // {$ne: null} is truthy and would otherwise widen the lookup to every company.
      expect(await tsWebhook({companyId: {$ne: null}, trigger: 'approval', data: {a: 1}}))
        .toEqual({errorMessage: '400 [companyId, trigger] are required for function execution'});
      expect(calls.find).toHaveLength(0);
    });

  it('answers 400 without querying when trigger is not a string', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD]});

    expect(await tsWebhook({companyId: 'c1', trigger: {$ne: null}, data: {a: 1}}))
      .toEqual({errorMessage: '400 [companyId, trigger] are required for function execution'});
    expect(calls.find).toHaveLength(0);
  });

  it('answers 400 without querying when projectId is not a string', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD]});

    expect(await tsWebhook({companyId: 'c1', projectId: {$ne: null}, trigger: 'approval', data: {a: 1}}))
      .toEqual({errorMessage: '400 [projectId] must be a string'});
    expect(calls.find).toHaveLength(0);
  });

  it('looks the rows up by company, trigger and project scope, untransformed', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD]});

    await tsWebhook({companyId: 'c1', projectId: 'p1', trigger: 'approval', data: {a: 1}});

    expect(calls.find[0].selector).toEqual({
      $and: [
        {companyId: 'c1', triggers: {$in: ['approval']}},
        {$or: [{projectId: {$exists: false}}, {projectId: 'p1'}]}
      ]
    });
    expect(calls.find[0].options.transform).toBeNull();
  });

  it('looks up only company-wide rows when the event has no project', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD]});

    await tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}});

    expect(calls.find[0].selector.$and[1]).toEqual({projectId: {$exists: false}});
  });

  it('answers 404 when no row matches, without starting a worker', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: []});

    const result = await tsWebhook({companyId: 'c1', projectId: 'p1', trigger: 'approval', data: {a: 1}});

    expect(result).toEqual({errorMessage: '404 Webhook by c1 and p1 with trigger approval was not found'});
    expect(calls.worker).toHaveLength(0);
  });

  it('answers with an errorMessage when the lookup itself fails, and never starts a worker',
    async () => {
      const {tsWebhook, calls} = loadTsWebhook({findError: new Error('connection reset')});
      const original = console.info;
      console.info = function () {};
      try {
        expect(await tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}}))
          .toEqual({errorMessage: 'connection reset'});
      } finally {
        console.info = original;
      }
      expect(calls.worker).toHaveLength(0);
    });

  it('drops a looked-up row that points at an internal address', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD, META]});
    const original = console.info;
    console.info = function () {};
    try {
      await tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}});
    } finally {
      console.info = original;
    }

    expect(calls.worker[0].input.targets.map((row) => row._id)).toEqual(['wh-good']);
  });

  it('skips the lookup for rows handed in, and still filters them', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: []});
    const original = console.info;
    console.info = function () {};
    try {
      await tsWebhook({companyId: 'c1', trigger: 'vulnerability', data: {a: 1}, webhook: [META, GOOD]});
    } finally {
      console.info = original;
    }

    expect(calls.find).toHaveLength(0);
    expect(calls.worker[0].input.targets.map((row) => row._id)).toEqual(['wh-good']);
  });

  it('answers with no deliveries when every target was dropped', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [META]});
    const original = console.info;
    console.info = function () {};
    try {
      expect(await tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}})).toEqual([]);
    } finally {
      console.info = original;
    }
    expect(calls.worker).toHaveLength(0);
  });

  it('hands the worker the trigger, the data, the scope and the targets', async () => {
    const {tsWebhook, calls} = loadTsWebhook({rows: [GOOD]});

    const result = await tsWebhook({
      companyId: 'c1', projectId: 'p1', projectName: 'Payments', moduleId: 'm1', moduleName: 'api',
      trigger: 'analysis', data: {_id: 'a1'}
    });

    expect(calls.worker[0].service).toBe('webhook');
    expect(calls.worker[0].input).toEqual({
      trigger: 'analysis',
      data: {_id: 'a1'},
      scope: {companyId: 'c1', projectId: 'p1', projectName: 'Payments', moduleId: 'm1', moduleName: 'api'},
      targets: [GOOD_PINNED]
    });
    expect(result).toEqual([{status: 200, data: 'ok'}]);
  });

  it('drops a host name that resolves to a private address', async () => {
    const internal = {_id: 'wh-intranet', type: 'webhook', url: 'https://intranet.example.com/hook'};
    const {tsWebhook, calls, lookups} = loadTsWebhook({rows: [internal, GOOD]});

    await capturingInfo(() => tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}}));

    expect(lookups).toContain('intranet.example.com');
    expect(calls.worker[0].input.targets.map((row) => row._id)).toEqual(['wh-good']);
  });

  it('drops a host name when ANY of its addresses is private', async () => {
    const split = {_id: 'wh-split', type: 'webhook', url: 'https://split.example.com/hook'};
    const {tsWebhook, calls} = loadTsWebhook({rows: [split, GOOD]});

    await capturingInfo(() => tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}}));

    expect(calls.worker[0].input.targets.map((row) => row._id)).toEqual(['wh-good']);
  });

  it('drops localhost', async () => {
    const local = {_id: 'wh-localhost', type: 'webhook', url: 'http://localhost:3000/hook'};
    const {tsWebhook, calls} = loadTsWebhook({rows: [local]});

    const result = await capturingInfo(async () => {
      expect(await tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}})).toEqual([]);
    });

    expect(result).toContain('wh-localhost');
    expect(calls.worker).toHaveLength(0);
  });

  it('drops a row whose host name does not resolve', async () => {
    const gone = {_id: 'wh-gone', type: 'webhook', url: 'https://gone.example.org/hook'};
    const {tsWebhook, calls, lookups} = loadTsWebhook({rows: [gone, GOOD]});

    await capturingInfo(() => tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}}));

    expect(lookups).toContain('gone.example.org');
    expect(calls.worker[0].input.targets.map((row) => row._id)).toEqual(['wh-good']);
  });

  it('hands the worker the addresses it checked, on a copy of the row', async () => {
    const stored = Object.assign({}, GOOD);
    const {tsWebhook, calls} = loadTsWebhook({rows: [stored]});

    await tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}});

    expect(calls.worker[0].input.targets).toEqual([GOOD_PINNED]);
    // The looked-up row itself is never changed (nothing may be written back to Mongo).
    expect(stored).toEqual(GOOD);
    expect(calls.worker[0].input.targets[0]).not.toBe(stored);
  });

  it('checks rows handed in with DNS too, and pins their addresses', async () => {
    const handed = {_id: 'wh-handed', type: 'webhook', url: 'http://localhost/hook'};
    const {tsWebhook, calls} = loadTsWebhook({rows: []});

    await capturingInfo(() => tsWebhook({companyId: 'c1', trigger: 'vulnerability', data: {a: 1},
      webhook: [handed, GOOD]}));

    expect(calls.worker[0].input.targets).toEqual([GOOD_PINNED]);
  });

  it('logs the dropped row id and never its url or headers', async () => {
    const secretRows = [
      {_id: 'wh-secret-local', type: 'webhook', url: 'http://localhost/hook/URL-PATH-TOKEN',
        headers: [{key: 'Authorization', value: 'Bearer HEADER-SECRET-VALUE'}]},
      {_id: 'wh-secret-gone', type: 'webhook', url: 'https://gone.example.org/services/URL-PATH-TOKEN',
        headers: [{key: 'x-api-key', value: 'HEADER-SECRET-VALUE'}]}
    ];
    const {tsWebhook} = loadTsWebhook({rows: secretRows});

    const logged = await capturingInfo(() => tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}}));

    expect(logged).toContain('wh-secret-local');
    expect(logged).toContain('wh-secret-gone');
    expect(logged).not.toContain('URL-PATH-TOKEN');
    expect(logged).not.toContain('HEADER-SECRET-VALUE');
    expect(logged).not.toContain('localhost');
    expect(logged).not.toContain('gone.example.org');
  });

  it('never throws when the worker fails', async () => {
    const {tsWebhook} = loadTsWebhook({rows: [GOOD], workerError: new Error('webhook worker did not finish within 90000 ms')});
    const original = console.info;
    console.info = function () {};
    try {
      expect(await tsWebhook({companyId: 'c1', trigger: 'approval', data: {a: 1}}))
        .toEqual({errorMessage: 'webhook worker did not finish within 90000 ms'});
    } finally {
      console.info = original;
    }
  });
});
