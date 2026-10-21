// COMPREHENSIVE two-tenant cross-tenant isolation regression (reads + mutations).
// Run (dev server up): node tools/security/regress-tenant-full.mjs
//   env: SEED_MONGO_URI (default mongodb://127.0.0.1:3001/meteor),
//        SEED_COMPANY_A (an existing non-IDM company id; default the local "1").
//
// Unlike regress-tenant.mjs (a self-discovering spot-check), this script SEEDS a
// full set of Company-B-owned docs across every tenant-scoped collection, grants
// User A the tenant roles in Company A (so A passes role checks but must be stopped
// by tenant scoping - the P6 "role-without-ownership" pattern), then:
//   READS  - calls every getProjectXxx + analysis/scans/logevents/loginsHistory
//            getter as A with B's ids; asserts no B data comes back.
//   WRITES - calls every Remove/Update as A on B's doc, then re-reads from Mongo to
//            assert B's doc is still present (Remove) / unmodified (Update).
// All seeded docs use the ZZSEC_ id prefix and are removed at the end.
//
// Global-catalog mutations (COTS/Infrastructure/Trademarks/LegalTemplates/Policy)
// are intentionally NOT probed: they are global-by-design + role-gated, not
// tenant-scoped, and probing a remove with a privileged A could delete real data.
import {MongoClient} from 'mongodb';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import {DDPClient, isDenied, serializedContains} from './ddp-client.mjs';

const URI = process.env.SEED_MONGO_URI || 'mongodb://127.0.0.1:3001/meteor';
const COMPANY_A = process.env.SEED_COMPANY_A || 'vLcEyNWfCPQSekJMq';
const COMPANY_B = 'ZZSEC_companyB';
const A_EMAIL = 'zzsec-a@example.com', B_EMAIL = 'zzsec-b@example.com', PW = '123456';
const bc = bcrypt.hashSync(crypto.createHash('sha256').update(PW).digest('hex'), 10);

// Tenant-scoped collections that get a single B-owned doc (id = ZZSEC_<coll>).
const TENANT_COLLS = ['riskProperties', 'tasks', 'capabilities', 'cryptoProperties',
  'qualityProperties', 'approves', 'csaf',
  'manualVulnerabilities', 'tags', 'webhooks', 'products', 'scans',
  'modules', 'noticeFiles', 'sbomFiles', 'analysis'];
const docId = (coll) => (coll === 'projects' ? 'ZZSEC_projB' : 'ZZSEC_' + coll);

// Roles to grant A in Company A (NOT the global-catalog ones).
const A_ROLES = ['manager', 'account_admin', 'portfolio_manager', 'compliance_manager',
  'company_security_manager', 'developer'];

// Read getters: [method, argsBuilder(ids)].
const READS = [
  ...['getProjectAlgorithms', 'getProjectAlgorithmsShort', 'getProjectBadAlgorithms',
    'getProjectCapabilities', 'getProjectCots', 'getProjectCredits', 'getProjectCriticalComponents',
    'getProjectDependent', 'getProjectEndoflife', 'getProjectExportControl', 'getProjectLicenses',
    'getProjectModification', 'getProjectObligations', 'getProjectSBOM',
    'getProjectTests', 'getProjectVersioning', 'getProjectViability', 'getProjectVulnerability',
    'getProjectVulnerabilityLive'].map((m) => [m, (b) => [b.proj, b.company, [], null, null]]),
  ['getAnalysis', (b) => [b.analysis]],
  ['getLastScanAnalysis', (b) => [b.scans]],
  ['getLastScanModule', (b) => [b.modules]],
  ['getLastModuleScan', (b) => [b.modules, b.analysis]],
  ['LogEvents.ByCompany', (b) => [{companyId: b.company}, 0, 50]],
  ['LogEvents.ByUser', (b) => [{companyId: b.company}, 0, 50]],
  ['LoginsHistory.ByCompany', (b) => [{companyId: b.company}, 0, 50]],
  ['LoginsHistory.NoLoginsByCompany', (b) => [b.company]]
];

// Mutations: [method, kind, collection].
const MUTATIONS = [
  ['RiskProperties.Remove', 'remove', 'riskProperties'], ['RiskProperties.Update', 'update', 'riskProperties'],
  ['Tasks.Remove', 'remove', 'tasks'], ['Tasks.Update', 'update', 'tasks'],
  ['Capabilities.Remove', 'remove', 'capabilities'], ['Capabilities.Update', 'update', 'capabilities'],
  ['CryptoProperties.Remove', 'remove', 'cryptoProperties'], ['CryptoProperties.Update', 'update', 'cryptoProperties'],
  ['QualityProperties.Remove', 'remove', 'qualityProperties'], ['QualityProperties.Update', 'update', 'qualityProperties'],
  ['Approves.Remove', 'remove', 'approves'], ['Approves.Update', 'update', 'approves'],
  ['CSAF.Remove', 'remove', 'csaf'], ['CSAF.Update', 'update', 'csaf'],
  ['ManualVulnerabilities.Remove', 'remove', 'manualVulnerabilities'], ['ManualVulnerabilities.Update', 'update', 'manualVulnerabilities'],
  ['Tags.Remove', 'remove', 'tags'], ['Webhook.Remove', 'remove', 'webhooks'],
  ['Products.Remove', 'remove', 'products'], ['Products.Update', 'update', 'products'],
  ['Scans.Update', 'update', 'scans'],
  ['Modules.Remove', 'remove', 'modules'], ['Projects.Remove', 'remove', 'projects'],
  ['NoticeFiles.Remove', 'remove', 'noticeFiles'], ['NoticeFiles.Update', 'update', 'noticeFiles'],
  ['SbomFiles.Remove', 'remove', 'sbomFiles'], ['SbomFiles.Update', 'update', 'sbomFiles']
];

const user = (id, email, companyId) => ({
  _id: id, createdAt: new Date(), emails: [{address: email, verified: true}],
  profile: {name: email, email, companyId, testuser: true},
  services: {password: {bcrypt: bc}, resume: {loginTokens: []}}
});

async function seed(db) {
  await db.collection('companies').updateOne({_id: COMPANY_B}, {$set: {_id: COMPANY_B, name: 'ZZ-sec-test-B', apiKeys: []}}, {upsert: true});
  await db.collection('users').deleteMany({'emails.address': {$in: [A_EMAIL, B_EMAIL]}});
  await db.collection('users').insertMany([user('ZZSEC_userA', A_EMAIL, COMPANY_A), user('ZZSEC_userB', B_EMAIL, COMPANY_B)]);
  // grant A the tenant roles in Company A
  await db.collection('role-assignment').deleteMany({'user._id': 'ZZSEC_userA'});
  await db.collection('role-assignment').insertMany(A_ROLES.map((r) => ({
    _id: 'ZZSEC_ra_' + r, user: {_id: 'ZZSEC_userA'}, role: {_id: r}, scope: COMPANY_A, inheritedRoles: [{_id: r}]
  })));
  // projects for both tenants (B project = target; A project = positive control source)
  await db.collection('projects').updateOne({_id: 'ZZSEC_projB'}, {$set: {_id: 'ZZSEC_projB', companyId: COMPANY_B, name: 'ZZSEC Project B', state: 'active'}}, {upsert: true});
  await db.collection('projects').updateOne({_id: 'ZZSEC_projA'}, {$set: {_id: 'ZZSEC_projA', companyId: COMPANY_A, name: 'ZZSEC Project A', state: 'active'}}, {upsert: true});
  // one B-owned doc per tenant collection
  for (const coll of TENANT_COLLS) {
    await db.collection(coll).updateOne({_id: docId(coll)},
      {$set: {_id: docId(coll), companyId: COMPANY_B, name: 'ZZSEC ' + coll, projectId: 'ZZSEC_projB', moduleId: 'ZZSEC_modules'}, $unset: {_zzsecPwned: ''}}, {upsert: true});
  }
  // Seed a known componentConfig.changedStatus baseline on B's module so the
  // Messages.Create status cross-tenant WRITE probe can assert it is left untouched.
  await db.collection('modules').updateOne({_id: 'ZZSEC_modules'},
    {$set: {'componentConfig.changedStatus': [{key: 'zzsec-baseline', version: '*', status: 'approved', comment: 'baseline'}]}});
}

async function cleanup(db) {
  for (const coll of [...TENANT_COLLS, 'projects']) {
    await db.collection(coll).deleteMany({_id: {$regex: '^ZZSEC_'}});
  }
  await db.collection('users').deleteMany({'emails.address': {$in: [A_EMAIL, B_EMAIL]}});
  await db.collection('role-assignment').deleteMany({'user._id': 'ZZSEC_userA'});
  await db.collection('companies').deleteMany({_id: COMPANY_B});
  // Remove any messages/approves the Create probes may have produced in
  // A's own company despite the foreign-id denials (defense-in-depth - keyed on
  // the ZZSEC marker so no real data is touched).
  await db.collection('messages').deleteMany({message: 'ZZSEC injection'});
  await db.collection('approves').deleteMany({name: 'ZZSEC_x'});
}

async function main() {
  if (!COMPANY_B.startsWith('ZZSEC')) { console.error('safety: COMPANY_B must be a ZZSEC test id'); process.exit(2); }
  const mongo = await MongoClient.connect(URI, {serverSelectionTimeoutMS: 3000});
  const db = mongo.db();
  let pass = 0, fail = 0;
  const check = (c, l) => { if (c) { pass++; console.log('  PASS', l); } else { fail++; console.log('  FAIL', l); } };

  try {
    await seed(db);
    const bIds = {company: COMPANY_B, proj: 'ZZSEC_projB', modules: 'ZZSEC_modules', scans: 'ZZSEC_scans', analysis: 'ZZSEC_analysis'};
    const allB = new Set(['ZZSEC_companyB', 'ZZSEC_projB', 'ZZSEC_userB', ...TENANT_COLLS.map(docId)]);

    const A = await new DDPClient().connect();
    const la = await A.login(A_EMAIL, PW);
    if (!A.userId) { console.error('A login failed:', JSON.stringify(la.error)); await cleanup(db); process.exit(1); }

    console.log(`-- READS: A (roles in ${COMPANY_A}) must get no Company-B data (${READS.length} getters) --`);
    for (const [method, build] of READS) {
      const args = build(bIds);
      const r = await A.call(method, args);
      const argStrs = new Set(args.flatMap((a) => (typeof a === 'string' ? [a] : (a && typeof a === 'object' ? Object.values(a).filter((v) => typeof v === 'string') : []))));
      const needles = new Set([...allB].filter((x) => !argStrs.has(x)));
      const proj = r.result && r.result.project;
      // A leak is ANY returned project that is B's (by _id or companyId), regardless
      // of which fields the projection includes, or any other B-private id appearing.
      const foreign = proj && (String(proj._id) === bIds.proj || String(proj.companyId) === COMPANY_B);
      const leakId = serializedContains(r.result, needles);
      const why = foreign ? 'foreign project doc' : (leakId ? 'B id ' + leakId : null);
      check(isDenied(r) || !why, `${method} -> ${isDenied(r) ? 'denied' : (why ? 'LEAK ' + why : 'no B data')}`);
    }

    console.log(`-- WRITES: A must not delete/modify Company-B docs (${MUTATIONS.length} methods) --`);
    for (const [method, kind, coll] of MUTATIONS) {
      const id = docId(coll);
      if (kind === 'remove') {
        await A.call(method, [id]);
        const still = await db.collection(coll).findOne({_id: id});
        check(!!still, `${method} -> B doc ${still ? 'intact' : 'DELETED'}`);
      } else {
        await A.call(method, [{$set: {_zzsecPwned: true}}, id]);
        const doc = await db.collection(coll).findOne({_id: id});
        check(!doc || doc._zzsecPwned !== true, `${method} -> B doc ${doc && doc._zzsecPwned === true ? 'MODIFIED' : 'unmodified'}`);
      }
    }

    // ---- CROSS-TENANT CREATE probes (Messages.Create, Approves.Create) ----
    // A (roles in its OWN company) must not create a Company-B-referencing approve
    // nor inject/spoof a Company-B message. These methods derive companyId
    // server-side; the attack is a foreign projectId/moduleId/userId/senderId.
    console.log('-- CREATES: A must not reference/inject Company-B via Create methods --');

    // Approves.Create with B's projectId → cross-tenant project reference must
    // be denied (403), and no approve doc may land in Company B.
    const apprBeforeFor = async (cid) => db.collection('approves').countDocuments({companyId: cid});
    const bApprBefore = await apprBeforeFor(COMPANY_B);
    const rApprProj = await A.call('Approves.Create',
      [{name: 'ZZSEC_x', version: '1', description: 'x', projectId: 'ZZSEC_projB', moduleId: null, modules: [], demo: true}]);
    const bApprAfterProj = await apprBeforeFor(COMPANY_B);
    check(isDenied(rApprProj) && bApprAfterProj === bApprBefore,
      `Approves.Create(foreign projectId) -> ${isDenied(rApprProj) ? 'denied' : 'ALLOWED'}; B approves ${bApprAfterProj === bApprBefore ? 'unchanged' : 'GREW'}`);

    // Approves.Create with B's moduleId → same.
    const rApprMod = await A.call('Approves.Create',
      [{name: 'ZZSEC_x', version: '1', description: 'x', projectId: 'ZZSEC_projB', moduleId: 'ZZSEC_modules', modules: [], demo: true}]);
    const bApprAfterMod = await apprBeforeFor(COMPANY_B);
    check(isDenied(rApprMod) && bApprAfterMod === bApprBefore,
      `Approves.Create(foreign moduleId) -> ${isDenied(rApprMod) ? 'denied' : 'ALLOWED'}; B approves ${bApprAfterMod === bApprBefore ? 'unchanged' : 'GREW'}`);

    // Messages.Create - a DDP client may only post a public, self-attributed
    // message in its OWN company. Spoofing senderId=B-user / userId=B-user /
    // companyId=B must NOT produce any message attributed to Company B, nor
    // addressed to / sent-by B's user.
    const msgBBefore = await db.collection('messages').countDocuments({companyId: COMPANY_B});
    const rMsg = await A.call('Messages.Create',
      [{userId: 'ZZSEC_userB', senderId: 'ZZSEC_userB', companyId: COMPANY_B,
        message: 'ZZSEC injection', type: 'componentComment'}]);
    const bForgedMsgs = await db.collection('messages').countDocuments({
      $or: [{companyId: COMPANY_B}, {userId: 'ZZSEC_userB'}, {senderId: 'ZZSEC_userB'}]
    });
    const msgBAfter = await db.collection('messages').countDocuments({companyId: COMPANY_B});
    check(bForgedMsgs === 0 && msgBAfter === msgBBefore,
      `Messages.Create(spoof B userId/senderId/companyId) -> ${rMsg.error ? 'errored' : 'ok'}; B-attributed messages ${bForgedMsgs === 0 ? 'none (forced caller scope)' : 'INJECTED ' + bForgedMsgs}`);
    // Defense-in-depth: clean up any A-scoped message this probe may have created.
    await db.collection('messages').deleteMany({message: 'ZZSEC injection'});

    // Cross-tenant WRITE IDOR via the Messages.Create status
    // side-effect. A (self-attributed, own company) passes B's moduleId with a
    // status type: the module lookup is now scoped to A's company, so it must NOT
    // resolve B's module → 403, and B's componentConfig.changedStatus must be left
    // exactly as seeded (no overwrite, no notification fan-out into B).
    const moduleBBaseline = await db.collection('modules').findOne({_id: 'ZZSEC_modules'});
    const baselineJson = JSON.stringify(moduleBBaseline && moduleBBaseline.componentConfig);
    const rMsgWrite = await A.call('Messages.Create',
      [{senderId: 'ZZSEC_userA', projectId: 'ZZSEC_projB', moduleId: 'ZZSEC_modules',
        componentKey: 'zzsec-baseline', status: 'rejected', subject: 'x',
        message: 'ZZSEC injection', type: 'changeComponentStatus'}]);
    const moduleBAfter = await db.collection('modules').findOne({_id: 'ZZSEC_modules'});
    const afterJson = JSON.stringify(moduleBAfter && moduleBAfter.componentConfig);
    check(isDenied(rMsgWrite) && afterJson === baselineJson,
      `Messages.Create(B moduleId + changeComponentStatus) -> ${isDenied(rMsgWrite) ? 'denied' : 'ALLOWED'}; B module componentConfig ${afterJson === baselineJson ? 'unchanged' : 'OVERWRITTEN'}`);
    // Defense-in-depth: clean up any A-scoped message this probe may have created.
    await db.collection('messages').deleteMany({message: 'ZZSEC injection'});

    console.log('-- positive control: A still operates within its OWN company --');
    const own = await A.call('getCompanyCurrent', []);
    check(own.result && String(own.result._id) === String(COMPANY_A), `getCompanyCurrent -> A's own company (${own.result && own.result._id})`);

    // publicCsafKeys is a CSAF-feed bearer credential and must NOT
    // be returned by the company-doc methods (getCompanyCurrent / getUserCompanies).
    // Temporarily seed a ZZSEC-marked key on A's OWN company doc, confirm neither
    // method leaks it, then restore A's original publicCsafKeys exactly.
    const aCompanyBefore = await db.collection('companies').findOne({_id: COMPANY_A}, {projection: {publicCsafKeys: 1}});
    const aCsafOriginal = aCompanyBefore && aCompanyBefore.publicCsafKeys;
    await db.collection('companies').updateOne({_id: COMPANY_A},
      {$set: {publicCsafKeys: [{key: 'ZZSEC_csaf_secret', name: 'ZZSEC', tlpLevels: ['WHITE'], published: true, requests: []}]}});
    try {
      const cur = await A.call('getCompanyCurrent', []);
      const curLeak = serializedContains(cur.result, new Set(['ZZSEC_csaf_secret']));
      check(!curLeak && !(cur.result && cur.result.publicCsafKeys),
        `getCompanyCurrent -> publicCsafKeys ${curLeak ? 'LEAKED ' + curLeak : 'stripped'}`);
      const ucs = await A.call('getUserCompanies', []);
      const ucsLeak = serializedContains(ucs.result, new Set(['ZZSEC_csaf_secret']));
      check(!ucsLeak, `getUserCompanies -> publicCsafKeys ${ucsLeak ? 'LEAKED ' + ucsLeak : 'stripped'}`);
    } finally {
      // Restore A's original publicCsafKeys (unset if it had none) - never leave a
      // test key on a real company doc.
      if (aCsafOriginal === undefined) {
        await db.collection('companies').updateOne({_id: COMPANY_A}, {$unset: {publicCsafKeys: ''}});
      } else {
        await db.collection('companies').updateOne({_id: COMPANY_A}, {$set: {publicCsafKeys: aCsafOriginal}});
      }
    }
    A.close();
  } finally {
    await cleanup(db);
    await mongo.close();
  }

  console.log(`\nFULL cross-tenant regression: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('error', e.message, e.stack); process.exit(2); });
setTimeout(() => { console.error('timeout'); process.exit(3); }, 120000);
