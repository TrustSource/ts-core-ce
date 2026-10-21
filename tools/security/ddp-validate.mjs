// Raw-DDP security validation against a running server (default ws://localhost:3000).
// Run: node tools/security/ddp-validate.mjs   (requires the dev server up; uses 'ws').
// Asserts:
//   - the central auth guard 401s unauthenticated method calls,
//   - allowlisted public methods still pass,
//   - tenant publications leak nothing to an anonymous subscriber,
//   - (authenticated, using the seeded dev manager) the company/project
//     publications exclude integration secrets and API keys.
import WebSocket from 'ws';
import crypto from 'crypto';

const URL = process.env.DDP_URL || 'ws://localhost:3000/websocket';
const LOGIN_EMAIL = process.env.DDP_TEST_EMAIL || 'manager@example.com';
const LOGIN_PASSWORD = process.env.DDP_TEST_PASSWORD || '123456';

const ws = new WebSocket(URL);
let nextId = 1; const pending = {};
// captured published docs: collection -> array of field objects
let captured = {};
const send = (o) => ws.send(JSON.stringify(o));
ws.on('open', () => send({msg: 'connect', version: '1', support: ['1']}));
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.msg === 'ping') return send({msg: 'pong', id: m.id});
  if (m.msg === 'connected') return runTests();
  if (m.msg === 'result') { const p = pending[m.id]; if (p) { p(m); delete pending[m.id]; } }
  if (m.msg === 'added') { (captured[m.collection] = captured[m.collection] || []).push(m.fields || {}); }
});
const callMethod = (method, params) => new Promise((res) => { const id = String(nextId++); pending[id] = res; send({msg: 'method', method, params, id}); });
const subscribe = (name, params) => new Promise((res) => { send({msg: 'sub', id: String(nextId++), name, params}); setTimeout(res, 1200); });
const resetCaptured = () => { captured = {}; };
const allDocs = () => Object.values(captured).flat();
const hashPassword = (pw) => ({digest: crypto.createHash('sha256').update(pw).digest('hex'), algorithm: 'sha-256'});

function hasDeep(obj, key) {
  if (!obj || typeof obj !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
  return Object.values(obj).some((v) => hasDeep(v, key));
}

async function runTests() {
  let pass = 0, fail = 0;
  const check = (c, l) => { if (c) { pass++; console.log('  PASS', l); } else { fail++; console.log('  FAIL', l); } };
  const is401 = (r) => r.error && (r.error.error === 401 || r.error.error === 403 || ['401', '403'].includes(String(r.error.error)));

  console.log('-- central DDP auth guard (unauth method calls) --');
  for (const meth of ['getCompanyCurrent', 'tsCsafUpload', 'getModulesHistory']) {
    const r = await callMethod(meth, ['x']);
    check(is401(r), `${meth} blocked for anon`);
  }

  console.log('-- allowlisted public method NOT blocked --');
  check(!is401(await callMethod('resetUserPassword', ['x@example.com'])), 'resetUserPassword passes guard');

  console.log('-- tenant publications leak nothing to anon subscriber --');
  for (const [pub, args] of [['userDetails', ['u']], ['approveDetail', ['a']], ['sbomDetail', ['s']],
    ['componentModificationDetail', ['c']], ['infrastructureModules', []], ['moduleImports', ['p']], ['company', []]]) {
    resetCaptured();
    await subscribe(pub, args);
    check(allDocs().length === 0, `${pub} -> ${allDocs().length} docs to anon`);
  }

  console.log('-- authenticated: publications exclude secrets --');
  const login = await callMethod('login', [{user: {email: LOGIN_EMAIL}, password: hashPassword(LOGIN_PASSWORD)}]);
  if (login.error || !login.result || !login.result.id) {
    console.log(`  SKIP authenticated checks (login failed: ${JSON.stringify(login.error || 'no result')}). ` +
      'Seed the dev fixtures or set DDP_TEST_EMAIL/DDP_TEST_PASSWORD.');
  } else {
    resetCaptured();
    await subscribe('company', []);
    const companies = allDocs();
    check(companies.length > 0, `company published to authenticated user (${companies.length} doc)`);
    check(!companies.some((d) => hasDeep(d, 'apiKeys')), 'company excludes apiKeys');
    check(!companies.some((d) => hasDeep(d, 'externalApiKeys')), 'company excludes externalApiKeys');
    check(!companies.some((d) => d.jira && hasDeep(d.jira, 'passwd')), 'company excludes jira.passwd');

    resetCaptured();
    await subscribe('projects', []);
    check(!allDocs().some((d) => d.jira && hasDeep(d.jira, 'passwd')), 'projects exclude jira.passwd');
    check(!allDocs().some((d) => d.tfs && hasDeep(d.tfs, 'token')), 'projects exclude tfs.token');
  }

  console.log(`\nDDP validation: ${pass} pass / ${fail} fail`);
  ws.close(); process.exit(fail ? 1 : 0);
}
ws.on('error', (e) => { console.log('ws error', e.message); process.exit(2); });
setTimeout(() => { console.log('timeout'); process.exit(3); }, 20000);
