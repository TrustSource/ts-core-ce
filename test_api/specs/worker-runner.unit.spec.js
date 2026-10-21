/* eslint-disable no-undef */
// The worker runner (imports/server/workerRunner/runWorker.js) runs one service call
// from workers/ on its own thread. These specs start REAL threads: a stand-in entry
// (test_api/helpers/worker-fixture/entry.js) for every way a call can end, and the
// real workers/entry.js with the webhook service for the delivery path.
//
// Needs the workers dependencies (`yarn --cwd workers install`, run by the root
// postinstall).
const path = require('path');
const http = require('http');
const workerThreads = require('worker_threads');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const REPO = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(__dirname, '..', 'helpers', 'worker-fixture');

function loadRunnerModule() {
  return loadMeteorModule('imports/server/workerRunner/runWorker.js', {
    'worker_threads': workerThreads,
    'path': path
  }, {globals: {setTimeout: setTimeout, clearTimeout: clearTimeout}});
}

// A Worker that records itself, so a spec can see how many threads are alive and that
// every one of them is gone once its call settled.
function trackedWorkers() {
  const state = {created: [], alive: 0, maxAlive: 0};
  class TrackedWorker extends workerThreads.Worker {
    constructor(file, options) {
      super(file, options);
      state.created.push(this);
      state.alive += 1;
      state.maxAlive = Math.max(state.maxAlive, state.alive);
      this.exited = new Promise((resolve) => {
        this.once('exit', (code) => {
          state.alive -= 1;
          resolve(code);
        });
      });
    }
  }
  state.WorkerClass = TrackedWorker;
  return state;
}

function fixtureRunner(tracked, limits, settings) {
  const {createWorkerRunner} = loadRunnerModule();
  return createWorkerRunner({
    workersDir: FIXTURE_DIR,
    getSettings: () => settings || {},
    limits: limits || {fixture: {concurrency: 2, timeoutMs: 5000}},
    WorkerClass: tracked.WorkerClass
  });
}

function allExited(tracked) {
  return Promise.all(tracked.created.map((worker) => worker.exited));
}

describe('createWorkerRunner', () => {
  it('resolves with the service result and hands the settings to the thread', async () => {
    const tracked = trackedWorkers();
    const runner = fixtureRunner(tracked, null, {MONGO_URL: 'mongodb://example/meteor'});

    const result = await runner.run('fixture', {behaviour: 'return', value: 7});

    expect(result).toEqual({echo: 7, settings: {MONGO_URL: 'mongodb://example/meteor'}});
    await allExited(tracked);
    expect(tracked.alive).toBe(0);
  });

  it('rejects with the error the service reported', async () => {
    const tracked = trackedWorkers();

    await expect(fixtureRunner(tracked).run('fixture', {behaviour: 'throw'}))
      .rejects.toMatchObject({message: 'service failed', code: 'E_SERVICE'});
    await allExited(tracked);
  });

  it('rejects when the thread dies of an unhandled rejection', async () => {
    const tracked = trackedWorkers();

    await expect(fixtureRunner(tracked).run('fixture', {behaviour: 'unhandled'}))
      .rejects.toMatchObject({code: 'WORKER_CRASHED'});
    await allExited(tracked);
  });

  it('rejects and terminates a thread that never answers', async () => {
    const tracked = trackedWorkers();
    const runner = fixtureRunner(tracked, {fixture: {concurrency: 1, timeoutMs: 200}});

    await expect(runner.run('fixture', {behaviour: 'hang'}))
      .rejects.toMatchObject({code: 'WORKER_TIMEOUT'});
    await allExited(tracked);
    expect(tracked.alive).toBe(0);
  });

  it('rejects when the thread exits before answering', async () => {
    const tracked = trackedWorkers();

    await expect(fixtureRunner(tracked).run('fixture', {behaviour: 'exit'}))
      .rejects.toMatchObject({code: 'WORKER_CRASHED', message: expect.stringContaining('code 3')});
  });

  it('refuses a service it has no limits for, without starting a thread', async () => {
    const tracked = trackedWorkers();

    await expect(fixtureRunner(tracked).run('unknown', {behaviour: 'return'}))
      .rejects.toThrow('Unknown worker service: unknown');
    expect(tracked.created).toHaveLength(0);
  });

  it('never has more threads of a service alive than its limit', async () => {
    const tracked = trackedWorkers();
    const runner = fixtureRunner(tracked, {fixture: {concurrency: 2, timeoutMs: 5000}});

    const calls = [1, 2, 3, 4, 5].map((value) => runner.run('fixture', {behaviour: 'slow', value: value, delayMs: 150}));

    await expect(Promise.all(calls)).resolves.toEqual([1, 2, 3, 4, 5]);
    await allExited(tracked);
    expect(tracked.created).toHaveLength(5);
    expect(tracked.maxAlive).toBeLessThanOrEqual(2);
  });

  it('delivers a webhook through the real workers/entry.js', async () => {
    const received = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        received.push({headers: request.headers, body: JSON.parse(body)});
        response.writeHead(200, {'Content-Type': 'text/plain'});
        response.end('ok');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const {createWorkerRunner} = loadRunnerModule();
      const runner = createWorkerRunner({
        workersDir: path.join(REPO, 'workers'),
        getSettings: () => ({}),
        limits: {webhook: {concurrency: 1, timeoutMs: 20000}}
      });
      const endpoint = `http://127.0.0.1:${server.address().port}/hook`;

      const result = await runner.run('webhook', {
        trigger: 'approval',
        data: {approved: true},
        scope: {companyId: 'c1'},
        targets: [{_id: 'w1', type: 'webhook', url: endpoint, headers: [{key: 'x-ts-test', value: 'yes'}]}]
      });

      expect(result).toEqual([{status: 200, data: 'ok'}]);
      expect(received).toHaveLength(1);
      expect(received[0].body).toEqual({approved: true});
      expect(received[0].headers['x-ts-test']).toBe('yes');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('worker settings in the server config', () => {
  function loadConfig(env, cwd) {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      return loadMeteorModule('imports/server/config.js', {
        'dotenv': {config: () => ({parsed: {}})},
        'path': path
      }, {globals: {process: {env: env, cwd: () => cwd || '/srv/app'}}}).Config;
    } finally {
      logSpy.mockRestore();
    }
  }

  it('uses the repository workers folder in development', () => {
    const config = loadConfig({NODE_ENV: 'development'}, '/repo/.meteor/local/build/programs/server');
    expect(config.TS_WORKERS_DIR).toBe('/repo/workers');
  });

  it('uses /opt/workers elsewhere', () => {
    expect(loadConfig({NODE_ENV: 'production'}).TS_WORKERS_DIR).toBe('/opt/workers');
  });

  it('lets TS_WORKERS_DIR override both', () => {
    expect(loadConfig({NODE_ENV: 'production', TS_WORKERS_DIR: '/data/workers'}).TS_WORKERS_DIR).toBe('/data/workers');
  });

  it('resolves a relative TS_WORKERS_DIR to an absolute path', () => {
    // A Worker is started from path.join(TS_WORKERS_DIR, 'entry.js'), and Node refuses a
    // relative worker path that does not start with ./ or ../.
    const dir = loadConfig({NODE_ENV: 'production', TS_WORKERS_DIR: 'deploy/workers'}).TS_WORKERS_DIR;
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir).toBe(path.resolve('deploy/workers'));
  });

  it('reads TS_ANALYSIS_CONCURRENCY as a positive integer, 2 otherwise', () => {
    expect(loadConfig({NODE_ENV: 'production', TS_ANALYSIS_CONCURRENCY: '3'}).TS_ANALYSIS_CONCURRENCY).toBe(3);
    expect(loadConfig({NODE_ENV: 'production', TS_ANALYSIS_CONCURRENCY: '0'}).TS_ANALYSIS_CONCURRENCY).toBe(2);
    expect(loadConfig({NODE_ENV: 'production', TS_ANALYSIS_CONCURRENCY: 'many'}).TS_ANALYSIS_CONCURRENCY).toBe(2);
    expect(loadConfig({NODE_ENV: 'production'}).TS_ANALYSIS_CONCURRENCY).toBe(2);
  });
});
