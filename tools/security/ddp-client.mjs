// Minimal raw-DDP client shared by the security regression scripts
// (regress-auth.mjs, regress-tenant.mjs). Mirrors the inline plumbing in
// ddp-validate.mjs but reusable, with login + captured-doc helpers.
//
// Requires the `ws` dependency (already a project dep) and a running server
// (default ws://localhost:3000/websocket, override with DDP_URL).
import WebSocket from 'ws';
import crypto from 'crypto';

export function hashPassword(pw) {
  return {digest: crypto.createHash('sha256').update(pw).digest('hex'), algorithm: 'sha-256'};
}

export class DDPClient {
  constructor(url) {
    this.url = url || process.env.DDP_URL || 'ws://localhost:3000/websocket';
    this.nextId = 1;
    this.pending = {};
    this.captured = {};   // collection -> [{_id, ...fields}]
    this.userId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      const timer = setTimeout(() => reject(new Error('DDP connect timeout')), 10000);
      this.ws.on('open', () => this._send({msg: 'connect', version: '1', support: ['1']}));
      this.ws.on('error', (e) => { clearTimeout(timer); reject(e); });
      this.ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.msg === 'ping') return this._send({msg: 'pong', id: m.id});
        if (m.msg === 'connected') { clearTimeout(timer); return resolve(this); }
        if (m.msg === 'result') { const p = this.pending[m.id]; if (p) { p(m); delete this.pending[m.id]; } }
        if (m.msg === 'added') {
          (this.captured[m.collection] = this.captured[m.collection] || [])
            .push(Object.assign({_id: m.id}, m.fields || {}));
        }
      });
    });
  }

  _send(o) { this.ws.send(JSON.stringify(o)); }

  call(method, params = []) {
    return new Promise((res) => {
      const id = String(this.nextId++);
      this.pending[id] = res;
      this._send({msg: 'method', method, params, id});
    });
  }

  sub(name, params = [], waitMs = 1200) {
    return new Promise((res) => {
      this._send({msg: 'sub', id: String(this.nextId++), name, params});
      setTimeout(res, waitMs);
    });
  }

  async login(email, password) {
    const r = await this.call('login', [{user: {email}, password: hashPassword(password)}]);
    this.userId = (r.result && r.result.id) || null;
    return r;
  }

  reset() { this.captured = {}; }
  docs(collection) { return collection ? (this.captured[collection] || []) : Object.values(this.captured).flat(); }
  close() { try { this.ws.close(); } catch { /* noop */ } }
}

// ---- result classifiers -------------------------------------------------
export const errCode = (r) => (r && r.error ? String(r.error.error) : null);
export const isDenied = (r) => ['401', '403'].includes(errCode(r));
// the central guard throws Meteor.Error(401, 'Authentication required')
export const isAuthGuard401 = (r) =>
  errCode(r) === '401' && /authentication required/i.test((r.error && (r.error.reason || r.error.message)) || '');
export const isThrottled = (r) =>
  !!(r && r.error && (errCode(r) === 'too-many-requests'
    || /too[- ]many|rate.?limit/i.test((r.error.reason || r.error.message) || '')));

// Deep search: does `obj` contain any of the `needles` (string ids) anywhere?
export function serializedContains(obj, needles) {
  if (!needles || !needles.size) return null;
  let json;
  try { json = JSON.stringify(obj); } catch { return null; }
  if (!json) return null;
  for (const n of needles) { if (n && json.includes(n)) return n; }
  return null;
}

// Collect every _id / companyId value seen across all captured docs.
export function collectIds(client) {
  const ids = new Set();
  for (const d of client.docs()) {
    if (d._id) ids.add(String(d._id));
    if (d.companyId) ids.add(String(d.companyId));
  }
  return ids;
}
