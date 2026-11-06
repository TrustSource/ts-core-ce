/* eslint-disable no-undef */
// The back-sync module copies commits merged in the public repository to the private one.
// These tests run against real temporary git repositories.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync, spawnSync} = require('child_process');
const {MARKER, isForwardSyncCommit, effectiveBase, listPending, applyPending, prBody, parsePublicHead, syncBranchName} = require('../../tools/sync/backsync');

const SCRIPT = path.join(__dirname, '..', '..', 'tools', 'sync', 'backsync.js');
const ACTION = 'GitHub Action <action@github.com>';
const ALICE = 'Alice <alice@example.com>';
const tmpDirs = [];

const git = (dir, ...args) => execFileSync('git', args, {cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backsync-'));
  tmpDirs.push(dir);
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.name', 'Tester');
  git(dir, 'config', 'user.email', 'tester@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

// `committer` ("Name <email>") sets the committer, as the workflow's git config does for the bot.
function commit(dir, file, content, msg, {author, committer} = {}) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '-A');
  const [, name, email] = committer ? /^(.*) <(.*)>$/.exec(committer) : [];
  git(dir, ...(committer ? ['-c', `user.name=${name}`, '-c', `user.email=${email}`] : []), 'commit', '-m', msg, ...(author ? ['--author', author] : []));
  return git(dir, 'rev-parse', 'HEAD');
}

// A public and a private repo with the same file contents but separate histories.
function makePair() {
  const pub = makeRepo();
  const priv = makeRepo();
  commit(pub, 'a.txt', 'one\ntwo\nthree\n', 'Initial');
  commit(priv, 'a.txt', 'one\ntwo\nthree\n', 'Initial');
  git(pub, 'tag', MARKER);
  return {pub, priv};
}

// Forward sync as it appears in public: a sync branch merged by a PR.
function addSyncMerge(pub) {
  git(pub, 'checkout', '-b', '1.0.3');
  commit(pub, 'synced.txt', 'sync\n', 'Automated sync for 1.0.3', {author: ACTION, committer: ACTION});
  git(pub, 'checkout', 'main');
  git(pub, 'merge', '--no-ff', '-m', 'Merge pull request #7 from TrustSource/1.0.3', '1.0.3');
}

// A contributor PR with one commit, merged with a merge commit.
function addPrMerge(pub, name, file, msg) {
  git(pub, 'checkout', '-b', name);
  commit(pub, file, `${name}\n`, msg, {author: ALICE});
  git(pub, 'checkout', 'main');
  git(pub, 'merge', '--no-ff', '-m', `Merge pull request #8 from alice/${name}`, name);
}

const run = (...args) => spawnSync('node', [SCRIPT, ...args], {encoding: 'utf8'});

afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, {recursive: true, force: true})));

describe('isForwardSyncCommit', () => {
  const BOT = 'action@github.com';
  const bot = (subject) => ({authorEmail: BOT, committerEmail: BOT, subject});
  it('detects a merged sync PR', () => expect(isForwardSyncCommit({subject: 'Merge pull request #7 from TrustSource/1.0.3', parents: ['a', 'b'], branchCommits: [bot('Automated sync for 1.0.3')]})).toBe(true));
  it('detects a squash-merged sync PR', () => expect(isForwardSyncCommit({subject: 'Automated Sync: 1.0.3 → main (#7)', parents: ['a']})).toBe(true));
  it('does not match a contributor merge', () => expect(isForwardSyncCommit({subject: 'Merge pull request #8 from alice/fix', parents: ['a', 'b'], branchCommits: [{authorEmail: 'alice@example.com', committerEmail: 'alice@example.com', subject: 'Fix typo'}]})).toBe(false));
  it('does not treat a merge of a TrustSource version branch as a sync by its subject', () => expect(isForwardSyncCommit({subject: 'Merge pull request #9 from TrustSource/1.0.4', parents: ['a', 'b'], branchCommits: [{authorEmail: 'bob@example.com', committerEmail: 'bob@example.com', subject: 'Fix login'}]})).toBe(false));
  it('does not match a merge whose branch has a sync commit and a commit by someone else', () => expect(isForwardSyncCommit({subject: 'Merge pull request #7 from bob/sync', parents: ['a', 'b'], branchCommits: [{authorEmail: 'bob@example.com', committerEmail: 'bob@example.com', subject: 'Resolve conflict'}, bot('Forced sync for 1.0.3')]})).toBe(false));
  it('does not match a sync subject with the bot as author only', () => expect(isForwardSyncCommit({subject: 'Merge pull request #7 from bob/sync', parents: ['a', 'b'], branchCommits: [{authorEmail: BOT, committerEmail: 'bob@example.com', subject: 'Automated sync for 1.0.3'}]})).toBe(false));
  it('does not match a bot commit without a sync subject', () => expect(isForwardSyncCommit({subject: 'Merge pull request #7 from TrustSource/1.0.3', parents: ['a', 'b'], branchCommits: [bot('Fix typo')]})).toBe(false));
  it('does not match a merge that brings in no commits', () => expect(isForwardSyncCommit({subject: 'Merge pull request #7 from TrustSource/1.0.3', parents: ['a', 'b'], branchCommits: []})).toBe(false));
  it('detects a rebase-merged forced sync', () => expect(isForwardSyncCommit({subject: 'Forced sync for 1.0.3', parents: ['a']})).toBe(true));
});

// A sync PR branch whose own history is changed before the merge (e.g. "Update branch").
function addSyncBranch(pub, msg = 'Automated sync for 1.0.3') {
  git(pub, 'checkout', '-b', '1.0.3');
  commit(pub, 'synced.txt', 'sync\n', msg, {author: ACTION, committer: ACTION});
  git(pub, 'checkout', 'main');
}

describe('listPending', () => {
  it('returns contributor merges and direct commits after the marker, oldest first, without sync commits', () => {
    const {pub} = makePair();
    addSyncMerge(pub);
    addPrMerge(pub, 'fix', 'fix.txt', 'Fix typo');
    commit(pub, 'direct.txt', 'd\n', 'Direct fix');
    const head = git(pub, 'rev-parse', 'HEAD');
    const pending = listPending(pub, effectiveBase(pub, null), head);
    expect(pending.map((p) => p.subject)).toEqual(['Merge pull request #8 from alice/fix', 'Direct fix']);
    expect(pending[0].range).toBe(`${pending[0].sha}^1..${pending[0].sha}^2`);
    expect(pending[1].range).toBe(`${pending[1].sha}^..${pending[1].sha}`);
  });

  it('ignores a sync PR whose branch merged main into itself', () => {
    const {pub} = makePair();
    addSyncBranch(pub);
    commit(pub, 'm.txt', 'm\n', 'Direct M');
    git(pub, 'checkout', '1.0.3');
    git(pub, 'merge', '--no-ff', '-m', 'Merge branch main into 1.0.3', 'main');
    git(pub, 'checkout', 'main');
    git(pub, 'merge', '--no-ff', '-m', 'Merge pull request #7 from TrustSource/1.0.3', '1.0.3');
    const pending = listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'));
    expect(pending.map((p) => p.subject)).toEqual(['Direct M']);
  });

  it('keeps a merge of a TrustSource version branch with a maintainer commit pending', () => {
    const {pub} = makePair();
    git(pub, 'checkout', '-b', '1.0.4');
    commit(pub, 'login.txt', 'fix\n', 'Fix login', {author: 'Bob <bob@example.com>'});
    git(pub, 'checkout', 'main');
    git(pub, 'merge', '--no-ff', '-m', 'Merge pull request #9 from TrustSource/1.0.4', '1.0.4');
    const pending = listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'));
    expect(pending.map((p) => p.subject)).toEqual(['Merge pull request #9 from TrustSource/1.0.4']);
  });

  it('keeps a contributor branch cut from an unmerged sync branch pending', () => {
    const {pub} = makePair();
    addSyncBranch(pub);
    git(pub, 'checkout', '-b', 'feature', '1.0.3');
    commit(pub, 'feature.txt', 'f\n', 'Add feature', {author: ALICE});
    git(pub, 'checkout', 'main');
    git(pub, 'merge', '--no-ff', '-m', 'Merge pull request #8 from alice/feature', 'feature');
    const pending = listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'));
    expect(pending.map((p) => p.subject)).toEqual(['Merge pull request #8 from alice/feature']);
  });

  it('ignores a squash-merged sync PR', () => {
    const {pub} = makePair();
    commit(pub, 'synced.txt', 'sync\n', 'Automated Sync: 1.0.3 → main (#7)', {author: ALICE});
    expect(listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'))).toEqual([]);
  });

  it('ignores rebase-merged automated and forced sync commits', () => {
    const {pub} = makePair();
    commit(pub, 'synced.txt', 'sync\n', 'Automated sync for 1.0.3', {author: ACTION});
    git(pub, 'commit', '--allow-empty', '-m', 'Forced sync for 1.0.4', '--author', ACTION);
    expect(listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'))).toEqual([]);
  });

  it('leaves out the --skip shas', () => {
    const {pub} = makePair();
    const c1 = commit(pub, 'x.txt', 'x\n', 'C1');
    const c2 = commit(pub, 'y.txt', 'y\n', 'C2');
    expect(listPending(pub, effectiveBase(pub, null), c2, [c1]).map((p) => p.sha)).toEqual([c2]);
  });

  it('throws when backsync-base is missing', () => {
    const dir = makeRepo();
    commit(dir, 'a.txt', 'x\n', 'Initial');
    expect(() => effectiveBase(dir, null)).toThrow('backsync-base tag not found in ' + dir);
  });

  it('uses --merged-head when the marker is its ancestor, ignores it otherwise', () => {
    const {pub} = makePair();
    const tagSha = git(pub, 'rev-parse', 'HEAD');
    commit(pub, 'b.txt', 'b\n', 'B');
    const merged = commit(pub, 'c.txt', 'c\n', 'C');
    expect(effectiveBase(pub, null)).toBe(tagSha);
    expect(effectiveBase(pub, merged)).toBe(merged);
    git(pub, 'checkout', '--orphan', 'other');
    const unrelated = commit(pub, 'o.txt', 'o\n', 'Unrelated');
    expect(effectiveBase(pub, unrelated)).toBe(tagSha);
    expect(effectiveBase(pub, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(tagSha);
  });
});

describe('applyPending', () => {
  it('applies a PR merge with author and message kept', () => {
    const {pub, priv} = makePair();
    addPrMerge(pub, 'fix', 'fix.txt', 'Fix typo');
    const pending = listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'));
    const result = applyPending(pub, priv, pending);
    expect(result.applied).toEqual([pending[0].sha]);
    expect(result.failed).toEqual([]);
    expect(git(priv, 'log', '-1', '--format=%an|%s')).toBe('Alice|Fix typo');
    expect(fs.existsSync(path.join(priv, 'fix.txt'))).toBe(true);
  });

  it('applies only the PR commits when the PR branch merged main into itself', () => {
    const {pub, priv} = makePair();
    git(pub, 'checkout', '-b', 'fix');
    commit(pub, 'fix.txt', 'fix\n', 'Fix typo', {author: ALICE});
    git(pub, 'checkout', 'main');
    commit(pub, 'd.txt', 'd\n', 'Direct D');
    git(pub, 'checkout', 'fix');
    git(pub, 'merge', '-m', 'Merge main into fix', 'main');
    git(pub, 'checkout', 'main');
    git(pub, 'merge', '--no-ff', '-m', 'Merge pull request #8 from alice/fix', 'fix');
    const pending = listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'));
    const result = applyPending(pub, priv, pending);
    expect(result.applied).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(git(priv, 'log', '--format=%s')).toBe('Fix typo\nDirect D\nInitial');
  });

  it('skips a commit whose change is already in private', () => {
    const {pub, priv} = makePair();
    commit(pub, 's.txt', 'hi\n', 'Add s');
    commit(priv, 's.txt', 'hi\n', 'Add s (private copy)');
    const pending = listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'));
    const result = applyPending(pub, priv, pending);
    expect(result.skipped).toEqual([pending[0].sha]);
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(git(priv, 'log', '--format=%s')).toBe('Add s (private copy)\nInitial');
  });

  it('skips a patch that am accepts without committing anything', () => {
    const pub = makeRepo();
    const priv = makeRepo();
    const lines = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'];
    const text = (ls) => ls.join('\n') + '\n';
    commit(pub, 'f.txt', text(lines), 'Initial');
    commit(priv, 'f.txt', text(lines), 'Initial');
    git(pub, 'tag', MARKER);
    const changed = lines.map((l) => (l === 'l5' ? 'L5' : l));
    const c1 = commit(pub, 'f.txt', text(changed), 'Change l5');
    // Private has the change, plus drift on l2: inside the hunk context, not adjacent to l5
    commit(priv, 'f.txt', text(changed.map((l) => (l === 'l2' ? 'L2' : l))), 'Change l5 and l2');
    const before = git(priv, 'rev-parse', 'HEAD');
    const result = applyPending(pub, priv, listPending(pub, effectiveBase(pub, null), c1));
    expect(result).toEqual({applied: [], skipped: [c1], failed: [], notApplied: [], reasons: {}});
    expect(git(priv, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(priv, 'status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(priv, '.git', 'rebase-apply'))).toBe(false);
  });

  it('puts the --skip shas in skipped and continues with later commits', () => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, 'a.txt', 'one\nTWO\nthree\n', 'C1');
    const c2 = commit(pub, 'y.txt', 'y\n', 'C2');
    commit(priv, 'a.txt', 'one\nzwei\nthree\n', 'C1 ported by hand');
    const result = applyPending(pub, priv, listPending(pub, effectiveBase(pub, null), c2), [c1]);
    expect(result).toEqual({applied: [c2], skipped: [c1], failed: [], notApplied: [], reasons: {}});
    expect(git(priv, 'log', '-1', '--format=%s')).toBe('C2');
  });

  it('stops at a conflicting patch and lists it and later ones', () => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, 'x.txt', 'x\n', 'C1');
    const c2 = commit(pub, 'a.txt', 'one\nTWO\nthree\n', 'C2');
    const c3 = commit(pub, 'y.txt', 'y\n', 'C3');
    commit(priv, 'a.txt', 'one\nzwei\nthree\n', 'Private change');
    const pending = listPending(pub, effectiveBase(pub, null), c3);
    const result = applyPending(pub, priv, pending);
    expect(result).toEqual({applied: [c1], skipped: [], failed: [c2], notApplied: [c3], reasons: {[c2]: 'patch does not apply'}});
    expect(git(priv, 'log', '-1', '--format=%s')).toBe('C1');
    expect(git(priv, 'status', '--porcelain')).toBe('');
  });

  it('fails a commit that touches .github and applies nothing from it', () => {
    const {pub, priv} = makePair();
    addPrMerge(pub, 'ci', '.github/workflows/x.yml', 'Add workflow');
    const c2 = commit(pub, 'y.txt', 'y\n', 'C2');
    const before = git(priv, 'rev-parse', 'HEAD');
    const pending = listPending(pub, effectiveBase(pub, null), c2);
    const result = applyPending(pub, priv, pending);
    expect(result).toEqual({applied: [], skipped: [], failed: [pending[0].sha], notApplied: [c2], reasons: {[pending[0].sha]: '.github change: port by hand'}});
    expect(git(priv, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(priv, 'status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(priv, '.github'))).toBe(false);
  });

  it('fails a commit that only deletes a file under .github', () => {
    const {pub, priv} = makePair();
    commit(pub, '.github/old.yml', 'o\n', 'Add old');
    commit(priv, '.github/old.yml', 'o\n', 'Add old');
    git(pub, 'tag', '-f', MARKER);
    git(pub, 'rm', '-q', '.github/old.yml');
    git(pub, 'commit', '-m', 'Remove old');
    const sha = git(pub, 'rev-parse', 'HEAD');
    const result = applyPending(pub, priv, listPending(pub, effectiveBase(pub, null), sha));
    expect(result.failed).toEqual([sha]);
    expect(result.reasons[sha]).toBe('.github change: port by hand');
  });

  it.each(['.github/workflows/\u00e9.yml', '.github/workflows/a"b.yml', '.github/actions/\u00fc/action.yml', '.GITHUB/x.yml'])('fails a commit that touches %s, a path git quotes or a case variant', (file) => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, file, 'on: push\n', 'Add workflow');
    const before = git(priv, 'rev-parse', 'HEAD');
    const result = applyPending(pub, priv, listPending(pub, effectiveBase(pub, null), c1));
    expect(result).toEqual({applied: [], skipped: [], failed: [c1], notApplied: [], reasons: {[c1]: '.github change: port by hand'}});
    expect(git(priv, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(priv, 'status', '--porcelain')).toBe('');
  });

  it('does not block a path that only starts with .github', () => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, '.githubx/notes.txt', 'n\n', 'Add notes');
    expect(applyPending(pub, priv, listPending(pub, effectiveBase(pub, null), c1)).applied).toEqual([c1]);
  });

  it('applies the real commit of a merge that also brings in an empty commit', () => {
    const {pub, priv} = makePair();
    git(pub, 'checkout', '-b', 'b');
    commit(pub, 'b.txt', 'b\n', 'Add b', {author: ALICE});
    git(pub, 'commit', '--allow-empty', '-m', 'Empty', '--author', ALICE);
    git(pub, 'checkout', 'main');
    git(pub, 'merge', '--no-ff', '-m', 'Merge pull request #8 from alice/b', 'b');
    const pending = listPending(pub, effectiveBase(pub, null), git(pub, 'rev-parse', 'HEAD'));
    const result = applyPending(pub, priv, pending);
    expect(result).toEqual({applied: [pending[0].sha], skipped: [], failed: [], notApplied: [], reasons: {}});
    expect(fs.readFileSync(path.join(priv, 'b.txt'), 'utf8')).toBe('b\n');
    expect(git(priv, 'log', '--format=%s')).toBe('Add b\nInitial');
    expect(git(priv, 'status', '--porcelain')).toBe('');
  });

  it('keeps non-UTF-8 bytes of a text file', () => {
    const {pub, priv} = makePair();
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0xfc, 0x0a]); // "café ü" in latin1
    const c1 = commit(pub, 'latin1.txt', bytes, 'Add latin1 file');
    const result = applyPending(pub, priv, listPending(pub, effectiveBase(pub, null), c1));
    expect(result.applied).toEqual([c1]);
    expect(fs.readFileSync(path.join(priv, 'latin1.txt')).equals(bytes)).toBe(true);
  });

  it('skips an empty public commit', () => {
    const {pub, priv} = makePair();
    git(pub, 'commit', '--allow-empty', '-m', 'Empty', '--author', ALICE);
    const c1 = git(pub, 'rev-parse', 'HEAD');
    const c2 = commit(pub, 'y.txt', 'y\n', 'C2');
    const result = applyPending(pub, priv, listPending(pub, effectiveBase(pub, null), c2));
    expect(result).toEqual({applied: [c2], skipped: [c1], failed: [], notApplied: [], reasons: {}});
    expect(git(priv, 'log', '--format=%s')).toBe('C2\nInitial');
  });
});

describe('prBody / parsePublicHead', () => {
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  it('round-trips the public head', () => expect(parsePublicHead(prBody({base: 'b', head: SHA, applied: ['x'], skipped: [], failed: [], notApplied: []}))).toBe(SHA));
  it('returns null without the line', () => expect(parsePublicHead('no head here')).toBeNull());
  it('returns null for a head that is not a full lowercase sha', () => {
    ['abc123', SHA.toUpperCase(), `${SHA}0`, '--upload-pack=x', `${SHA.slice(0, 39)}g`].forEach((h) => expect(parsePublicHead(`Public-Head: ${h}`)).toBeNull());
  });
  it('names the reason of each failed sha', () => {
    const body = prBody({base: 'b', head: 'h', applied: [], skipped: [], failed: ['f1'], notApplied: ['n1'], reasons: {f1: '.github change: port by hand'}});
    expect(body).toContain('- f1: .github change: port by hand');
    expect(body).toContain('- n1');
  });
  it('lists one bullet per sha in each non-empty group', () => {
    const body = prBody({base: 'b', head: 'h', applied: ['a1', 'a2'], skipped: ['s1'], failed: [], notApplied: []});
    expect(body).toContain('- a1');
    expect(body).toContain('- a2');
    expect(body).toContain('- s1');
  });
});

describe('syncBranchName', () => {
  it('returns the version', () => expect(syncBranchName('1.0.3', ['main'])).toBe('1.0.3'));
  it('rejects an existing branch', () => expect(() => syncBranchName('1.0.3', ['main', '1.0.3'])).toThrow('Branch 1.0.3 already exists in the public repo: bump package.json first'));
  it('rejects a non x.y.z version', () => expect(() => syncBranchName('1.0', [])).toThrow('Version 1.0 is not x.y.z'));
  it('rejects leading zeros', () => ['01.0.3', '1.00.3', '1.0.03'].forEach((v) => expect(() => syncBranchName(v, [])).toThrow(`Version ${v} is not x.y.z`)));
  it('accepts zero and multi-digit parts', () => ['0.0.0', '1.0.0', '10.20.30'].forEach((v) => expect(syncBranchName(v, [])).toBe(v)));
});

describe('CLI', () => {
  it('guard exits 1 and names the pending commit', () => {
    const {pub} = makePair();
    commit(pub, 'direct.txt', 'd\n', 'Direct fix');
    const r = run('guard', pub);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('Direct fix');
    expect(r.stdout + r.stderr).toContain('Run the Back-sync workflow and merge its PR first.');
  });

  it('guard exits 0 when only sync commits follow the marker', () => {
    const {pub} = makePair();
    addSyncMerge(pub);
    expect(run('guard', pub).status).toBe(0);
  });

  it('guard honours --merged-head', () => {
    const {pub} = makePair();
    const head = commit(pub, 'direct.txt', 'd\n', 'Direct fix');
    expect(run('guard', pub, '--merged-head', head).status).toBe(0);
  });

  it('guard does not count a --skip sha as pending', () => {
    const {pub} = makePair();
    const c1 = commit(pub, 'direct.txt', 'd\n', 'Direct fix');
    expect(run('guard', pub, '--skip', c1).status).toBe(0);
  });

  it('pending and apply take --skip as a comma-separated list', () => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, 'x.txt', 'x\n', 'C1');
    const c2 = commit(pub, 'y.txt', 'y\n', 'C2');
    const c3 = commit(pub, 'z.txt', 'z\n', 'C3');
    const pending = JSON.parse(run('pending', pub, '--skip', `${c1}, ${c2}`).stdout);
    expect(pending.pending.map((p) => p.sha)).toEqual([c3]);
    const r = run('apply', pub, priv, '--skip', `${c1},${c2}`);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({applied: [c3], skipped: [c1, c2], failed: [], head: c3});
    expect(out.body).toContain(`- ${c1}`);
  });

  it('reports and warns about --skip shas that are not pending', () => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, 'x.txt', 'x\n', 'C1');
    const unknown = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const p = run('pending', pub, '--skip', `${c1},${unknown}`);
    expect(JSON.parse(p.stdout)).toMatchObject({pending: [], unusedSkip: [unknown]});
    expect(p.stderr).toContain(`--skip shas not pending: ${unknown}`);
    const a = run('apply', pub, priv, '--skip', `${c1},${unknown}`);
    expect(JSON.parse(a.stdout)).toMatchObject({skipped: [c1], unusedSkip: [unknown]});
    expect(a.stderr).toContain(`--skip shas not pending: ${unknown}`);
    expect(JSON.parse(run('pending', pub).stdout).unusedSkip).toEqual([]);
  });

  it('pending and apply report the commits treated as forward sync', () => {
    const {pub, priv} = makePair();
    addSyncMerge(pub);
    const merge = git(pub, 'rev-parse', 'HEAD');
    const squash = commit(pub, 'synced.txt', 'sync2\n', 'Automated Sync: 1.0.4 → main (#9)', {author: ALICE});
    const c1 = commit(pub, 'x.txt', 'x\n', 'C1');
    const expected = [{sha: merge, subject: 'Merge pull request #7 from TrustSource/1.0.3'}, {sha: squash, subject: 'Automated Sync: 1.0.4 → main (#9)'}];
    const pending = JSON.parse(run('pending', pub).stdout);
    expect(pending.pending.map((p) => p.sha)).toEqual([c1]);
    expect(pending.forwardSync).toEqual(expected);
    expect(JSON.parse(run('apply', pub, priv).stdout).forwardSync).toEqual(expected);
  });

  it('apply fails a .github change and names the reason in the body', () => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, '.github/workflows/x.yml', 'on: push\n', 'Add workflow');
    const r = run('apply', pub, priv);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({applied: [], failed: [c1], reasons: {[c1]: '.github change: port by hand'}});
    expect(out.body).toContain(`- ${c1}: .github change: port by hand`);
  });

  it('rejects a --skip value that is not a list of full shas', () => {
    const {pub} = makePair();
    const r = run('pending', pub, '--skip', 'abc123');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--skip');
  });

  it('pending prints base, head and the pending list', () => {
    const {pub} = makePair();
    const head = commit(pub, 'direct.txt', 'd\n', 'Direct fix');
    const out = JSON.parse(run('pending', pub).stdout);
    expect(out.head).toBe(head);
    expect(out.pending.map((p) => p.subject)).toEqual(['Direct fix']);
  });

  it('apply exits 1 when a patch fails and still prints JSON with body', () => {
    const {pub, priv} = makePair();
    const before = git(pub, 'rev-parse', 'HEAD');
    const c1 = commit(pub, 'a.txt', 'one\nTWO\nthree\n', 'C1');
    commit(priv, 'a.txt', 'one\nzwei\nthree\n', 'Private change');
    const r = run('apply', pub, priv);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.failed).toEqual([c1]);
    expect(out.head).toBe(before);
    expect(out.body).toContain(`Public-Head: ${before}`);
  });

  it('apply reports the public HEAD when nothing failed', () => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, 'n.txt', 'n\n', 'C1');
    const out = JSON.parse(run('apply', pub, priv).stdout);
    expect(out.head).toBe(c1);
    expect(out.body).toContain(`Public-Head: ${c1}`);
  });

  it('keeps the failed and later commits pending when a partial result is used as --merged-head', () => {
    const {pub, priv} = makePair();
    const c1 = commit(pub, 'x.txt', 'x\n', 'C1');
    const c2 = commit(pub, 'a.txt', 'one\nTWO\nthree\n', 'C2');
    const c3 = commit(pub, 'y.txt', 'y\n', 'C3');
    commit(priv, 'a.txt', 'one\nzwei\nthree\n', 'Private change');
    const out = JSON.parse(run('apply', pub, priv).stdout);
    expect(out.applied).toEqual([c1]);
    const again = JSON.parse(run('pending', pub, '--merged-head', parsePublicHead(out.body)).stdout);
    expect(again.pending.map((p) => p.sha)).toEqual([c2, c3]);
  });

  it('branch-name prints the name or fails with the error', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backsync-')), 'branches.txt');
    tmpDirs.push(path.dirname(file));
    fs.writeFileSync(file, 'main\n1.0.3\n');
    expect(run('branch-name', '1.0.4', file).stdout.trim()).toBe('1.0.4');
    const r = run('branch-name', '1.0.3', file);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Branch 1.0.3 already exists in the public repo: bump package.json first');
  });

  it('exits 2 with usage for an unknown command', () => expect(run('nope').status).toBe(2));
});
