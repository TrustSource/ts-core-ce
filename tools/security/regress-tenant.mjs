// Two-tenant cross-tenant isolation regression.
// Run: DDP_A_EMAIL=.. DDP_A_PASSWORD=.. DDP_B_EMAIL=.. DDP_B_PASSWORD=.. \
//        node tools/security/regress-tenant.mjs        (requires the dev server up)
//
// Verifies the core invariant of security/ddp-auth-tenant-hardening: an authenticated
// user in Company A can never read Company B's data - via either a METHOD call (with B's
// ids, incl. the client-trusted-companyId footgun) or a PUBLICATION subscription with B's
// ids. Also re-asserts the secret-exclusion (no apiKeys / jira.passwd in `company`/`projects`)
// and a POSITIVE control (A still sees its OWN data - guards against over-scoping regressions).
//
// Self-seeding: it discovers B's ids by logging in as B and reading B's own
// getCompanyCurrent + `projects` subscription, then attacks those ids as A.
//
// Requires two users in DIFFERENT companies. Skips gracefully if not provided.
import {DDPClient, collectIds, serializedContains, isDenied} from './ddp-client.mjs';

const A = {email: process.env.DDP_A_EMAIL, password: process.env.DDP_A_PASSWORD};
const B = {email: process.env.DDP_B_EMAIL, password: process.env.DDP_B_PASSWORD};

// Tenant-scoped detail publications to probe as A using B's ids - expect 0 docs.
const DETAIL_PUBS = ['projectsById', 'sbomDetail', 'approveDetail', 'userDetails', 'infrastructureModules'];

// Read methods to call as A with B's (projectId, companyId) - must not return B data.
// Signatures: getProjectXxx(projectId, companyId, moduleIds?), getModulesHistory(companyId).
const PROJECT_METHODS = ['getProjectObligations', 'getProjectLicenses', 'getProjectVulnerabilityLive'];

// What the CWE-mapping isolation probe has seeded and not yet withdrawn. A `finally` covers every
// throw, but the hard timeout below cannot await a cleanup - so it names the
// residue instead of exiting silently on top of it.
let probeResidue = null;
// Set only while the profile.companyId probe has moved tenant A into B (the hole
// is open) and A has not been moved back yet.
let profileResidue = null;

async function main() {
  if (!A.email || !A.password || !B.email || !B.password) {
    console.log('SKIP cross-tenant regression - set DDP_A_EMAIL/PASSWORD and DDP_B_EMAIL/PASSWORD ' +
      '(two users in DIFFERENT companies).');
    process.exit(0);
  }

  let pass = 0, fail = 0;
  const check = (cond, label) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label); } };

  // ---- Tenant B: log in and discover B's private ids ----
  const cb = await new DDPClient().connect();
  const bLogin = await cb.login(B.email, B.password);
  if (bLogin.error || !cb.userId) { console.log('  FAIL tenant-B login:', JSON.stringify(bLogin.error)); process.exit(1); }
  const bCompany = (await cb.call('getCompanyCurrent')).result || {};
  const bCompanyId = bCompany._id;
  await cb.sub('projects');
  await cb.sub('company');
  const bProject = cb.docs('projects')[0] || {};
  const bProjectId = bProject._id;
  const bIds = collectIds(cb);   // every _id / companyId B can legitimately see
  if (bCompanyId) bIds.add(String(bCompanyId));
  console.log(`-- discovered tenant B: companyId=${bCompanyId || '?'} projectId=${bProjectId || '?'} (${bIds.size} private ids) --`);

  // ---- Tenant A: log in ----
  const ca = await new DDPClient().connect();
  const aLogin = await ca.login(A.email, A.password);
  if (aLogin.error || !ca.userId) { console.log('  FAIL tenant-A login:', JSON.stringify(aLogin.error)); process.exit(1); }
  const aCompany = (await ca.call('getCompanyCurrent')).result || {};
  const aCompanyId = aCompany._id;
  // discover A's own project (for the positive control)
  await ca.sub('projects');
  const aProjectId = (ca.docs('projects').find((d) => String(d.companyId) === String(aCompanyId)) || {})._id;
  ca.reset();

  console.log('-- sanity: A and B are different tenants --');
  check(aCompanyId && bCompanyId && aCompanyId !== bCompanyId,
    `A.companyId(${aCompanyId}) !== B.companyId(${bCompanyId})`);
  if (aCompanyId === bCompanyId) { console.log('  ABORT - same company; cannot test isolation.'); ca.close(); cb.close(); process.exit(1); }
  // A's own ids must NOT be in the "B private" set we scan against
  bIds.delete(String(aCompanyId));
  // ids A legitimately supplies as args are echoed back -> not a leak by themselves
  const argIds = new Set([String(bProjectId), String(bCompanyId)]);
  const foreignNeedles = new Set([...bIds].filter((x) => !argIds.has(x)));

  console.log('-- methods: A passing B\'s ids must not return B data (client companyId is pinned) --');
  // A leak is: (a) the returned `project` belongs to a company other than A, or
  // (b) any B-private id A did NOT supply as an argument appears in the result.
  for (const m of PROJECT_METHODS) {
    const r = await ca.call(m, [bProjectId || 'x', bCompanyId || 'x', []]);
    const proj = r.result && r.result.project;
    const foreignProject = proj && proj.companyId && String(proj.companyId) !== String(aCompanyId);
    const otherId = serializedContains(r.result, foreignNeedles);
    const why = foreignProject ? `foreign project (companyId=${proj.companyId})` : (otherId ? `B id ${otherId}` : null);
    check(isDenied(r) || !why, `${m}(B.project, B.company) -> ${isDenied(r) ? 'denied' : (why ? 'LEAK ' + why : 'no B data')}`);
  }
  {
    const r = await ca.call('getModulesHistory', [bCompanyId || 'x']);
    const leak = serializedContains(r.result, foreignNeedles);
    check(isDenied(r) || !leak, `getModulesHistory(B.company) -> ${isDenied(r) ? 'denied' : (leak ? 'LEAK ' + leak : 'no B data')}`);
  }

  console.log('-- publications: A subscribing with B\'s ids must capture 0 B docs --');
  for (const pub of DETAIL_PUBS) {
    ca.reset();
    await ca.sub(pub, [bProjectId || 'x']);
    const leaked = ca.docs().filter((d) => bIds.has(String(d._id)) || bIds.has(String(d.companyId)));
    check(leaked.length === 0, `${pub}(B.id) -> ${leaked.length} B docs`);
  }

  console.log('-- secret exclusion still holds for A\'s own company/projects --');
  // NB: DDP delivers docs under the Mongo COLLECTION name ('companies'/'projects'),
  // not the publication name.
  ca.reset();
  await ca.sub('company');
  const aCompanies = ca.docs('companies');
  const hasSecret = (d) => JSON.stringify(d).match(/"apiKeys"|"passwd"|"token"/);
  check(aCompanies.length > 0 && !aCompanies.some(hasSecret), 'company excludes apiKeys / jira.passwd / tfs.token');
  ca.reset();
  await ca.sub('projects');
  check(!ca.docs('projects').some(hasSecret), 'projects exclude jira.passwd / tfs.token');

  console.log('-- positive control: A still sees its OWN data (no over-scoping) --');
  // Use a FRESH connection: re-subscribing on `ca` would hit the DDP merge-box
  // dedup (docs already delivered by an active sub are not re-sent as `added`).
  const cpos = await new DDPClient().connect();
  await cpos.login(A.email, A.password);
  await cpos.sub('company');
  check(cpos.docs('companies').some((d) => String(d._id) === String(aCompanyId)),
    'A receives its own company doc');
  if (aProjectId) {
    const cproj = await new DDPClient().connect();
    await cproj.login(A.email, A.password);
    await cproj.sub('projectsById', [aProjectId]);
    check(cproj.docs('projects').some((d) => String(d._id) === String(aProjectId)),
      'A receives its OWN project via projectsById');
    cproj.close();
  }
  cpos.close();

  console.log('-- users: A cannot move itself into B\'s company with a client profile write --');
  {
    // accounts-base allows a client to modify its own `profile`, and allow-deny
    // accepts a write once any allow rule passes. Without the Meteor.users.deny
    // rule this single call re-homes A in company B.
    const own = {_id: ca.userId};
    const moved = await ca.call('/users/update', [own, {$set: {'profile.companyId': bCompanyId}}, {}]);
    if (!isDenied(moved)) {
      // The write went through: A now resolves to B. Put A back before anything else.
      profileResidue = {userId: ca.userId, companyId: aCompanyId};
    }
    try {
      check(isDenied(moved),
        `client $set profile.companyId=B -> ${isDenied(moved) ? 'denied' : 'ALLOWED (A was moved into B)'}`);
      const c = await new DDPClient().connect();
      await c.login(A.email, A.password);
      const current = (await c.call('getCompanyCurrent')).result || {};
      c.close();
      check(String(current._id) === String(aCompanyId), `A still resolves to its own company (got ${current._id})`);
    } finally {
      if (profileResidue) {
        const restored = await ca.call('/users/update', [own, {$set: {'profile.companyId': aCompanyId}}, {}]);
        if (!restored.error) profileResidue = null;
      }
    }

    // Positive control: the account-activation page still writes the own name.
    // Written back unchanged, so the probe leaves nothing behind.
    const cn = await new DDPClient().connect();
    await cn.login(A.email, A.password);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const self = cn.docs('users').find((d) => d._id === cn.userId);
    const name = self && self.profile && self.profile.name;
    if (typeof name === 'string') {
      const renamed = await cn.call('/users/update', [{_id: cn.userId}, {$set: {'profile.name': name}}, {}]);
      check(!renamed.error, `client $set own profile.name (unchanged) -> ${renamed.error ? 'rejected' : 'allowed'}`);
    } else {
      console.log('  SKIP own profile.name positive control - tenant A has no profile.name');
    }
    cn.close();
  }

  console.log('-- cwe mappings (#112): an assignment is filed under the caller, never the argument --');
  {
    const PROBE_TOOL = 'regress-probe-tool';
    const PROBE_RULE = 'regress.cross.tenant.probe';
    const seesProbe = async (who) => {
      // Fresh connection each time: re-subscribing on a live client hits the DDP
      // merge-box dedup and re-sends nothing.
      const c = await new DDPClient().connect();
      await c.login(who.email, who.password);
      await c.sub('cweMappings');
      const docs = c.docs('cweMappings');
      c.close();
      return docs;
    };

    // A assigns a CWE and lies about the company while doing it. CweMappings.Set
    // takes no companyId at all - it reads the caller's - so the lie has to be
    // inert rather than merely rejected.
    const assigned = await ca.call('CweMappings.Set', [{
      tool: PROBE_TOOL, ruleId: PROBE_RULE, cwes: ['CWE-79'],
      companyId: bCompanyId, company: bCompanyId
    }]);
    if (isDenied(assigned)) {
      // NOT a skip. Reporting "no failures" for isolation checks that never ran
      // is how a CI job with an under-privileged account passes while testing
      // nothing at all. Give tenant A company_security_manager or account_admin.
      check(false, 'CweMappings.Set denied for tenant A - the #112 isolation checks DID NOT RUN ' +
        '(give tenant A company_security_manager or account_admin)');
    } else {
      // The probe now exists in the database. Everything from here on is inside
      // a try/finally so that a failing assertion, a dropped connection or any
      // other throw still withdraws it - the top-level catch in main() would
      // otherwise leave one customer's mapping behind for the next run to find.
      probeResidue = {tool: PROBE_TOOL, ruleId: PROBE_RULE, companyId: aCompanyId};
      try {
        const aDocs = await seesProbe(A);
        const probe = aDocs.find((d) => d.ruleId === PROBE_RULE);
        check(!!probe && String(probe.companyId) === String(aCompanyId),
          `assignment filed under A, not the companyId A sent (got ${probe ? probe.companyId : 'nothing'})`);
        check(!aDocs.some((d) => d.companyId && String(d.companyId) !== String(aCompanyId)),
          'A receives only its own mappings and the global defaults');
        check(!aDocs.some((d) => 'userName' in d || 'createdBy' in d || 'status' in d),
          'published mappings name no curator (global defaults are TrustSource-internal)');
        check(!(await seesProbe(B)).some((d) => d.ruleId === PROBE_RULE),
          'B never sees the assignment A made');

        // ...and B cannot withdraw it, even naming A's company explicitly.
        const bWithdraw = await cb.call('CweMappings.Remove', [{
          tool: PROBE_TOOL, ruleId: PROBE_RULE, companyId: aCompanyId
        }]);
        check((await seesProbe(A)).some((d) => d.ruleId === PROBE_RULE),
          `A's assignment survives B's withdraw attempt${isDenied(bWithdraw) ? ' (denied)' : ''}`);
      } finally {
        // Remove exactly what this probe seeded, and nothing else.
        await ca.call('CweMappings.Remove', [{tool: PROBE_TOOL, ruleId: PROBE_RULE}]);
        probeResidue = null;
      }
      check(!(await seesProbe(A)).some((d) => d.ruleId === PROBE_RULE),
        'probe assignment withdrawn again, no residue left behind');
    }
  }

  console.log(`\ncross-tenant regression: ${pass} pass / ${fail} fail`);
  ca.close(); cb.close();
  clearTimeout(watchdog);
  process.exit(fail ? 1 : 0);
}

function reportResidue() {
  if (probeResidue) {
    console.error('RESIDUE LEFT BEHIND - remove this cwe mapping by hand:', JSON.stringify(probeResidue));
  }
  if (profileResidue) {
    console.error('RESIDUE LEFT BEHIND - set this user\'s profile.companyId back by hand:', JSON.stringify(profileResidue));
  }
}

main().catch((e) => { console.error('error', e.message); reportResidue(); process.exit(2); });
const watchdog = setTimeout(() => {
  console.error('timeout');
  reportResidue();
  process.exit(3);
}, 60000);
