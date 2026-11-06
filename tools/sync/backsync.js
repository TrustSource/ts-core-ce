// Back-sync: copies commits merged in the public TrustSource CE repository to the
// private development repository.
//
// The private repo is copied to the public one by a quarterly rsync-based forward sync,
// so the two repos share no git history, only identical file contents right after a sync.
// Contributors' PRs are merged in the public repo; this module finds those commits after
// the `backsync-base` marker tag and applies them to the private repo with
// git format-patch / git am, keeping author and message.
//
// Plain CommonJS with no dependencies; every git call uses an argument array (no shell).
// CLI: node tools/sync/backsync.js <pending|apply|guard|branch-name> ... [--merged-head <sha>] [--skip <sha,...>]

const fs = require('fs');
const {execFileSync} = require('child_process');

const MARKER = 'backsync-base';
const SYNC_BOT_EMAIL = 'action@github.com';
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const GITHUB_DIR_REASON = '.github change: port by hand';
const NO_APPLY_REASON = 'patch does not apply';

// `raw` returns a Buffer: patches keep their bytes (files need not be UTF-8).
function git(cwd, args, input, {raw} = {}) {
  return execFileSync('git', args, {cwd, encoding: raw ? 'buffer' : 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024});
}

const isSyncSubject = (subject) => subject.startsWith('Automated sync for ') || subject.startsWith('Forced sync for ');

// A commit made by the forward sync: a merged sync PR (also after "Update branch" on it), or
// (squash/rebase merge) the PR itself, recognised by its subject. `branchCommits` are the
// non-merge commits the merge brings in (`<sha>^1..<sha>^2`); every one of them must be a sync
// commit authored and committed by the workflow, so a branch with any other commit stays pending.
function isForwardSyncCommit({subject, parents, branchCommits = []}) {
  if (parents.length > 1) {
    const isBotSync = (c) => c.authorEmail === SYNC_BOT_EMAIL && c.committerEmail === SYNC_BOT_EMAIL && isSyncSubject(c.subject);
    return branchCommits.length > 0 && branchCommits.every(isBotSync);
  }
  return subject.startsWith('Automated Sync: ') || isSyncSubject(subject);
}

function isAncestor(dir, ancestor, descendant) {
  try {
    git(dir, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (e) {
    return false;
  }
}

// The commit after which public commits are still pending: the marker tag, or the head
// of an already merged back-sync PR when the marker has not been moved yet.
function effectiveBase(publicDir, mergedHead) {
  let tag;
  try {
    tag = git(publicDir, ['rev-parse', '--verify', `refs/tags/${MARKER}^{commit}`]).trim();
  } catch (e) {
    throw new Error(`${MARKER} tag not found in ${publicDir}`);
  }
  return mergedHead && isAncestor(publicDir, tag, mergedHead) ? mergedHead : tag;
}

// Sorts the first-parent commits after `base` into `pending`, `forwardSync` (left out, but
// reported so a spoofed sync subject is visible) and `usedSkip` (pending ones listed in `skip`,
// the shas handled by hand, see --skip).
function scanPublic(publicDir, base, head, skip = []) {
  const log = git(publicDir, ['log', '--first-parent', '--reverse', '--format=%H%x00%P%x00%s', `${base}..${head}`]);
  const result = {pending: [], forwardSync: [], usedSkip: []};
  log.split('\n').filter(Boolean).forEach((line) => {
    const [sha, parentList, subject] = line.split('\0');
    const parents = parentList.split(' ').filter(Boolean);
    let branchCommits;
    if (parents.length > 1) {
      branchCommits = git(publicDir, ['log', '--no-merges', '--format=%ae%x00%ce%x00%s', `${parents[0]}..${parents[1]}`]).split('\n').filter(Boolean)
        .map((entry) => {
          const [authorEmail, committerEmail, commitSubject] = entry.split('\0');
          return {authorEmail, committerEmail, subject: commitSubject};
        });
    }
    if (isForwardSyncCommit({subject, parents, branchCommits})) {
      result.forwardSync.push({sha, subject});
    } else if (skip.includes(sha)) {
      result.usedSkip.push(sha);
    } else {
      result.pending.push({sha, subject, range: parents.length > 1 ? `${sha}^1..${sha}^2` : `${sha}^..${sha}`});
    }
  });
  return result;
}

function listPending(publicDir, base, head, skip = []) {
  return scanPublic(publicDir, base, head, skip).pending;
}

// Every path the commits of `range` touch (both sides of a rename), as format-patch emits them.
// -z keeps the paths unquoted, so a non-ASCII or quoted name cannot hide a .github path.
function changedPaths(publicDir, range) {
  return git(publicDir, ['log', '-z', '--no-merges', '--no-renames', '--format=', '--name-only', range]).split('\0').filter(Boolean);
}

// Case-insensitive: on a case-insensitive file system .GITHUB/ is the same directory.
const isGithubPath = (p) => {
  const lower = p.toLowerCase();
  return lower === '.github' || lower.startsWith('.github/');
};

function canApply(privateDir, args, patch) {
  try {
    git(privateDir, args, patch);
    return true;
  } catch (e) {
    return false;
  }
}

function abortAm(privateDir) {
  try {
    git(privateDir, ['am', '--abort']);
  } catch (e) {
    // no am in progress
  }
}

// Applies the pending items in order. Stops at the first item that cannot be applied, leaving
// the private working tree clean; that item is `failed` (with its entry in `reasons`) and the
// rest are `notApplied`. A change under .github/ is never applied: pushed with the workflow's
// token it could run in the private repo before review, so it is ported by hand.
// Items in `skip` (handled by hand, see --skip), empty commits and patches that commit nothing are `skipped`.
function applyPending(publicDir, privateDir, pending, skip = []) {
  const result = {applied: [], skipped: [], failed: [], notApplied: [], reasons: {}};
  const fail = (i, reason) => {
    result.failed.push(pending[i].sha);
    result.reasons[pending[i].sha] = reason;
    result.notApplied = pending.slice(i + 1).map((p) => p.sha);
  };
  for (let i = 0; i < pending.length; i++) {
    const {sha, range} = pending[i];
    if (skip.includes(sha)) {
      result.skipped.push(sha);
      continue;
    }
    const paths = changedPaths(publicDir, range);
    if (!paths.length) {
      result.skipped.push(sha);
      continue;
    }
    if (paths.some(isGithubPath)) {
      fail(i, GITHUB_DIR_REASON);
      break;
    }
    const patch = git(publicDir, ['format-patch', '--stdout', range], undefined, {raw: true});
    const before = git(privateDir, ['rev-parse', 'HEAD']).trim();
    // Already in private (e.g. a change made there first)
    if (canApply(privateDir, ['apply', '--check', '--reverse'], patch)) {
      result.skipped.push(sha);
    } else if (canApply(privateDir, ['am', '--3way', '--keep-cr', '--empty=drop'], patch)) {
      // am can succeed without a commit when the 3-way merge finds the change already there
      if (git(privateDir, ['rev-parse', 'HEAD']).trim() === before) {
        abortAm(privateDir);
        result.skipped.push(sha);
      } else {
        result.applied.push(sha);
      }
    } else {
      abortAm(privateDir);
      fail(i, NO_APPLY_REASON);
      break;
    }
  }
  return result;
}

function prBody({base, head, applied, skipped, failed, notApplied, reasons = {}}) {
  const group = (title, shas) => (shas.length ? [`${title}:`, ...shas.map((s) => (reasons[s] ? `- ${s}: ${reasons[s]}` : `- ${s}`)), ''] : []);
  return [
    'Back-sync of commits merged in the public repository.',
    '',
    `Base: ${base}`,
    `Public-Head: ${head}`,
    '',
    ...group('Applied', applied),
    ...group('Skipped (already in the private repository)', skipped),
    ...group('Failed (resolve by hand)', failed),
    ...group('Not applied (after the failed commit)', notApplied),
  ].join('\n');
}

function parsePublicHead(body) {
  const match = /^Public-Head: ([0-9a-f]{40})\s*$/m.exec(body || '');
  return match ? match[1] : null;
}

function syncBranchName(version, existingBranches) {
  if (!VERSION.test(version)) throw new Error(`Version ${version} is not x.y.z`);
  if (existingBranches.includes(version)) throw new Error(`Branch ${version} already exists in the public repo: bump package.json first`);
  return version;
}

// Removes `--name <value>` from argv; returns the value (null when absent) and the rest.
function takeOption(argv, name) {
  const idx = argv.indexOf(name);
  if (idx < 0) return {value: null, rest: argv};
  return {value: argv[idx + 1], rest: argv.filter((_, i) => i !== idx && i !== idx + 1)};
}

// --skip: comma-separated full public shas whose change was ported to private by hand.
function parseSkip(value) {
  if (value === null) return [];
  const shas = String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = shas.filter((s) => !SHA.test(s));
  if (!shas.length || bad.length) throw new Error(`--skip takes a comma-separated list of full 40-character shas, got: ${value}`);
  return shas;
}

function main(argv) {
  const merged = takeOption(argv, '--merged-head');
  const skipOpt = takeOption(merged.rest, '--skip');
  const mergedHead = merged.value;
  const [cmd, publicDir, privateDir] = skipOpt.rest;
  const out = (value) => console.log(JSON.stringify(value, null, 2));
  let skip = [];
  // `unusedSkip`: --skip shas that match no pending commit (a typo, or already behind the base)
  const state = () => {
    const base = effectiveBase(publicDir, mergedHead);
    const head = git(publicDir, ['rev-parse', 'HEAD']).trim();
    const {pending, forwardSync, usedSkip} = scanPublic(publicDir, base, head, skip);
    const unusedSkip = skip.filter((s) => !usedSkip.includes(s));
    if (unusedSkip.length) console.error(`Warning: --skip shas not pending: ${unusedSkip.join(', ')}`);
    return {base, head, pending, forwardSync, unusedSkip};
  };

  try {
    skip = parseSkip(skipOpt.value);
    if (cmd === 'pending' && publicDir) {
      out(state());
    } else if (cmd === 'apply' && publicDir && privateDir) {
      const {base, head: publicHead, forwardSync, unusedSkip} = state();
      // List the skipped shas too, so the PR body names them under Skipped
      const result = applyPending(publicDir, privateDir, listPending(publicDir, base, publicHead), skip);
      // After a failure the head is the last fully handled commit, so the failed commit
      // and the ones after it stay pending when this PR's Public-Head is used as --merged-head.
      const head = result.failed.length ? git(publicDir, ['rev-parse', `${result.failed[0]}^1`]).trim() : publicHead;
      out({base, head, ...result, forwardSync, unusedSkip, body: prBody({base, head, ...result})});
      return result.failed.length ? 1 : 0;
    } else if (cmd === 'guard' && publicDir) {
      const {pending} = state();
      if (!pending.length) return 0;
      const list = pending.map((p) => `${p.sha.slice(0, 7)} ${p.subject}`).join(', ');
      console.error(`Public main has commits not yet back-synced: ${list}. Run the Back-sync workflow and merge its PR first.`);
      return 1;
    } else if (cmd === 'branch-name' && publicDir && privateDir) {
      const branches = fs.readFileSync(privateDir, 'utf8').split('\n').map((b) => b.trim()).filter(Boolean);
      console.log(syncBranchName(publicDir, branches));
    } else {
      console.error('Usage: node tools/sync/backsync.js <pending <publicDir> | apply <publicDir> <privateDir> | guard <publicDir> | branch-name <version> <branches-file>> [--merged-head <sha>] [--skip <sha,...>]');
      return 2;
    }
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  return 0;
}

module.exports = {MARKER, isForwardSyncCommit, effectiveBase, scanPublic, listPending, applyPending, prBody, parsePublicHead, syncBranchName};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
