import {DDPRateLimiter} from 'meteor/ddp-rate-limiter';

// ---------------------------------------------------------------------------
// Authentication brute-force / credential-stuffing throttling.
//
// accounts-base adds a per-connection default rule, but an attacker can open
// many DDP connections from one IP and bypass it. These rules add per-client-IP
// limits on the login and token-bearing account methods. We deliberately do NOT
// implement hard per-account lockout (it lets an attacker lock a victim out by
// failing their login - a denial-of-service); IP + connection throttling is the
// safer mitigation.
// ---------------------------------------------------------------------------

// Methods that accept a password or a (guessable) token and must be throttled
// per source IP to prevent brute-forcing.
const THROTTLED_AUTH_METHODS = new Set([
  'login',
  'resetPassword',
  'forgotPassword',
  'changePassword',
  'resetUserPassword',
  'resetPasswordByToken',
  'verifyUserPassword',
  'getUserInfoByToken',
  'resendEnrollmentEmail'
]);

// Per client IP, across all of the above: 20 attempts / minute.
DDPRateLimiter.addRule({
  type: 'method',
  name(name) { return THROTTLED_AUTH_METHODS.has(name); },
  clientAddress() { return true; }
}, 20, 60 * 1000);

// Self sign-up, per client IP: 10 / hour. Every accepted createUser creates an
// account AND a company, and accounts-base's own limit is per connection, which
// a client side-steps by opening a new connection per call. Failed attempts
// count too, so a person retrying a typo is not blocked for long; admin
// invitations create accounts on the server and are not affected.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'createUser',
  clientAddress() { return true; }
}, 10, 60 * 60 * 1000);

// Per connection + login: a tight short-window limit (5 / 10s) to blunt rapid
// online guessing on a single connection.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'login',
  connectionId() { return true; }
}, 5, 10 * 1000);

// Per connection, token-lookup methods: 10 / 10s (token brute-force).
DDPRateLimiter.addRule({
  type: 'method',
  name(name) { return name === 'verifyUserPassword' || name === 'getUserInfoByToken' || name === 'resetPasswordByToken'; },
  connectionId() { return true; }
}, 10, 10 * 1000);

// ---------------------------------------------------------------------------
// CPU-bound write throttling (defense-in-depth).
// ---------------------------------------------------------------------------

// Projects.UpdateArchitecture writes up to a 100KB body on every
// call, and nothing else bounds how often a single connection can send one.
// 6 calls/10s is well above any legitimate "upload architecture.md, review,
// re-upload" interaction.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'Projects.UpdateArchitecture',
  connectionId() { return true; }
}, 6, 10 * 1000);

// CweMappings.Set walks a caller-supplied array of weakness ids and
// then writes; CweMappings.Remove runs a scoped delete. Both are cheap per call
// once the interactors bound their input (at most CWE_MAPPING_MAX_CWES ids, and
// tool/ruleId capped at the schema's lengths), but nothing bounded how OFTEN,
// and both are reachable by any company_security_manager. Same 6-calls/10s shape
// as the CPU-bound writes above: assigning a CWE is one click in the findings
// list, and withdrawing one is another - there is no bulk action behind either.
DDPRateLimiter.addRule({
  type: 'method',
  name(name) { return name === 'CweMappings.Set' || name === 'CweMappings.Remove'; },
  connectionId() { return true; }
}, 6, 10 * 1000);

// RiskProperties.ReconcileFromSarif re-reads up to
// SARIF_RECONCILE_MAX_TESTS stored SARIF documents, JSON.parses each of them and
// then writes at most CWE_RISKS_MAX_PER_TOOL risks. Every one of those is bounded
// per call by the interactor, but nothing bounded how OFTEN, and it is reachable
// by any authenticated user for any module of their own company - including
// against an OLD import's test ids, which makes it a cheap-to-send,
// comparatively expensive-to-serve replay. Same 6-calls/10s shape as the
// CPU-bound writes above: a SARIF upload fires it exactly once, and there is no
// bulk action behind it.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'RiskProperties.ReconcileFromSarif',
  connectionId() { return true; }
}, 6, 10 * 1000);

// ...and the same method again PER USER. A per-connection rule is only ever a
// bound on one tab: a client chooses how many DDP connections it opens, so the
// effective limit is 6 x however many it opens. This is the rule that bounds the
// actor. Both apply - DDPRateLimiter enforces every matching rule - so the
// per-connection one above stays as the tighter bound on a single connection.
// 12/10s is two connections' worth, well above a real "upload SARIF, watch the
// register refresh" interaction, which fires this exactly once.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'RiskProperties.ReconcileFromSarif',
  userId(userId) { return !!userId; }
}, 12, 10 * 1000);

// Licenses.Create / Licenses.Update (license catalog) write the catalog every company on
// the installation shares, and every self-registered user holds the editor role
// (company_component_manager). Each write also reloads the whole catalog, texts
// included, into the in-process license cache. Same 6-calls/10s per-connection shape
// as the writes above, plus a per-user bound, because a client chooses how many
// connections it opens.
DDPRateLimiter.addRule({
  type: 'method',
  name(name) { return name === 'Licenses.Create' || name === 'Licenses.Update'; },
  connectionId() { return true; }
}, 6, 10 * 1000);

DDPRateLimiter.addRule({
  type: 'method',
  name(name) { return name === 'Licenses.Create' || name === 'Licenses.Update'; },
  userId(userId) { return !!userId; }
}, 12, 10 * 1000);

// InfrastructureComponents.Create writes the infrastructure catalog every company on the
// installation shares, and every self-registered user holds company_component_manager.
// Same shape as the license catalog writes above.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'InfrastructureComponents.Create',
  connectionId() { return true; }
}, 6, 10 * 1000);

DDPRateLimiter.addRule({
  type: 'method',
  name: 'InfrastructureComponents.Create',
  userId(userId) { return !!userId; }
}, 12, 10 * 1000);

// generateDemoData creates a demo project, module and scan and then runs processScan and
// a full module analysis. The method itself returns early once the company has a demo
// project, but a remove/generate loop would still restart that work each round. A person
// loads the demo once or twice; 3 calls/10s per connection and 5/minute per user is
// plenty, and the per-user rule bounds a client that opens more connections.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'generateDemoData',
  connectionId() { return true; }
}, 3, 10 * 1000);

DDPRateLimiter.addRule({
  type: 'method',
  name: 'generateDemoData',
  userId(userId) { return !!userId; }
}, 5, 60 * 1000);

// Companies.UpdateDetails saves the company name, email and logo URL, and a new logo
// URL starts a server-side fetch of that image (bounded to 10s and the logo size cap,
// but still one outbound request per call). Every self-registered user is the
// account_admin of their own company, so anyone can reach it. 5 calls/10s per
// connection is far above "edit the details, save, fix a typo, save again"; the
// per-user rule (10 / minute) bounds a client that opens more connections.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'Companies.UpdateDetails',
  connectionId() { return true; }
}, 5, 10 * 1000);

DDPRateLimiter.addRule({
  type: 'method',
  name: 'Companies.UpdateDetails',
  userId(userId) { return !!userId; }
}, 10, 60 * 1000);

// The CSAF product_id methods run a cipher per element of a caller-supplied
// batch. Unlike every other CSAF method they carry no role check and no
// 'csaf' feature gate (VEX export is used by companies without a CSAF licence),
// so any authenticated user reaches them. One call is already bounded - at most
// CSAF_ID_BATCH_MAX elements, each at most CSAF_ID_MAX_LENGTH characters
// (imports/server/csaf/productIdMethods.js) - but nothing bounded how OFTEN, and
// decode in particular is cheap to send and comparatively expensive to serve.
//
// 30 calls / 10s per connection is far above any real interaction: opening a CSAF
// document is one decode for the whole document, exporting a report is one encode
// for the whole module set, and ticking a checkbox in the wizard is one encode for
// that one id (there is no select-all).
DDPRateLimiter.addRule({
  type: 'method',
  name(name) { return name === 'CSAF.EncodeModuleIds' || name === 'CSAF.DecodeProductIds'; },
  connectionId() { return true; }
}, 30, 10 * 1000);

// Products.Import creates up to MAX_IMPORT_PRODUCTS products per call. A real
// import is a single upload, retried after fixing the file.
DDPRateLimiter.addRule({
  type: 'method',
  name: 'Products.Import',
  userId(userId) { return !!userId; }
}, 5, 60 * 1000);
