/* eslint-disable no-undef */
// Source checks for the public/private sync workflows.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');
const wf = (name) => yaml.load(read(`.github/workflows/${name}`));

describe('back-sync.yml', () => {
  const w = wf('back-sync.yml');
  it('runs once a day and on dispatch', () => {
    expect(w.on.schedule).toHaveLength(1);
    expect(w.on.schedule[0].cron).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(w.on).toHaveProperty('workflow_dispatch');
  });
  it('runs only in the private repo', () => expect(w.jobs['back-sync'].if).toBe("github.repository == 'eacg-gmbh/ts-core-ce'"));
  it('is named Back-sync, as the checklist and the module say', () => expect(w.name).toBe('Back-sync'));
  it('takes a skip input and passes it to apply only, through an env var', () => {
    expect(w.on.workflow_dispatch.inputs.skip).toMatchObject({type: 'string', required: false});
    const steps = w.jobs['back-sync'].steps;
    const apply = steps.find((s) => s.id === 'apply');
    expect(apply.env.SKIP).toBe('${{ inputs.skip }}');
    expect(apply.run).toMatch(/if \[ -n "\$SKIP" \]; then ARGS\+=\(--skip "\$SKIP"\); fi/);
    // pending keeps the skipped shas in count, so a skip-only run still reaches apply
    const pending = steps.find((s) => s.id === 'pending');
    expect(pending.env).not.toHaveProperty('SKIP');
    expect(pending.run).not.toMatch(/--skip/);
    expect(read('.github/workflows/back-sync.yml').match(/\$\{\{ *(github\.event\.)?inputs\.skip *\}\}/g)).toHaveLength(1);
  });
  it('uses the module and the back-sync branch', () => {
    const src = read('.github/workflows/back-sync.yml');
    expect(src).toMatch(/tools\/sync\/backsync\.js apply/);
    expect(src).toMatch(/--head back-sync/);
    expect(src).toMatch(/secrets\.FFFFRA_PAT/);
    expect(src).toMatch(/backsync-base/);
  });
  it('validates the apply JSON before pushing or touching the PR', () => {
    const src = read('.github/workflows/back-sync.yml');
    const validate = src.indexOf('jq -e');
    expect(validate).toBeGreaterThan(-1);
    expect(validate).toBeLessThan(src.indexOf('git push -f origin back-sync'));
    expect(validate).toBeLessThan(src.indexOf('gh pr create'));
  });
  it('closes the PR and moves the marker when nothing was applied or failed', () => {
    const src = w.jobs['back-sync'].steps.find((s) => s.id === 'apply').run;
    const empty = src.indexOf('(.applied | length) == 0 and (.failed | length) == 0');
    expect(empty).toBeGreaterThan(-1);
    expect(src).toMatch(/gh pr close back-sync/);
    expect(src.indexOf('gh pr close back-sync')).toBeGreaterThan(empty);
    expect(src.indexOf('gh pr close back-sync')).toBeLessThan(src.indexOf('git push -f origin back-sync'));
    expect(src).toMatch(/git tag -f backsync-base "\$\(jq -r '\.head'/);
  });
  it('stops without a push or PR change when nothing applied and a commit failed', () => {
    const src = w.jobs['back-sync'].steps.find((s) => s.id === 'apply').run;
    const cond = src.indexOf('(.applied | length) == 0 and (.failed | length) > 0');
    expect(cond).toBeGreaterThan(src.indexOf("jq -e '(.body | type) == \"string\"'"));
    expect(cond).toBeLessThan(src.indexOf('git push -f origin back-sync'));
    const block = src.slice(cond, src.indexOf('\nfi', cond));
    expect(block).toMatch(/exit 1/);
    expect(block).not.toMatch(/gh pr|git push|git tag/);
    // the failed shas and reasons reach the step summary before the stop
    const summary = src.indexOf('.failed[] as $s');
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(cond);
    expect(src.slice(summary, cond)).toMatch(/\.reasons\[\$s\][^\n]*>> "\$GITHUB_STEP_SUMMARY"/);
  });
  it('writes the commits treated as forward sync to the step summary', () => {
    const pending = w.jobs['back-sync'].steps.find((s) => s.id === 'pending').run;
    expect(pending).toMatch(/\.forwardSync\[\][^\n]*"\$RUNNER_TEMP\/pending\.json" >> "\$GITHUB_STEP_SUMMARY"/);
  });
  it('writes the unused skip shas to the step summary', () => {
    const apply = w.jobs['back-sync'].steps.find((s) => s.id === 'apply').run;
    expect(apply).toMatch(/\.unusedSkip\[\][^\n]*"\$RUNNER_TEMP\/apply\.json" >> "\$GITHUB_STEP_SUMMARY"/);
  });
  it('closes a stale open back-sync PR and moves the marker to public HEAD when nothing is pending', () => {
    const marker = w.jobs['back-sync'].steps.find((s) => s.id === 'marker').run;
    const zero = marker.indexOf('if [ "$COUNT" = "0" ]; then');
    const block = marker.slice(zero, marker.indexOf('\nfi', zero) + 3);
    expect(block).toMatch(/if \[ "\$OPEN" != "0" \]; then\n\s*gh pr close back-sync -R "\$PRIVATE_REPO" --comment/);
    expect(block.split('\n').map((l) => l.trim())).toContain('TARGET="$HEAD_SHA"');
    expect(block).not.toMatch(/then TARGET="\$HEAD_SHA"/);
    expect(marker.indexOf('gh pr close back-sync')).toBeLessThan(marker.indexOf('git push -f origin refs/tags/backsync-base'));
  });
  it('uses github.token for every operation on the private repo and FFFFRA_PAT only to clone the public repo', () => {
    const job = w.jobs['back-sync'];
    expect(job.permissions).toEqual({contents: 'write', 'pull-requests': 'write'});
    expect(job.env.GH_TOKEN).toBe('${{ github.token }}');
    const checkout = job.steps.find((s) => /actions\/checkout/.test(s.uses || ''));
    expect(checkout.with).not.toHaveProperty('token');
    const withPat = job.steps.filter((s) => JSON.stringify(s).includes('FFFFRA_PAT'));
    expect(withPat.map((s) => s.name)).toEqual(['Clone Public Repo']);
    const clone = withPat[0];
    expect(clone.env.PUBLIC_TOKEN).toBe('${{ secrets.FFFFRA_PAT }}');
    expect(clone.run).not.toMatch(/\$\{\{/);
    expect(clone.run).toMatch(/git clone "https:\/\/x-access-token:\$\{PUBLIC_TOKEN\}@github\.com\/\$\{PUBLIC_REPO\}" public-repo/);
    expect(read('.github/workflows/back-sync.yml').match(/secrets\.FFFFRA_PAT/g)).toHaveLength(1);
    // the public tag is pushed from the public clone, the back-sync branch from the private checkout
    const apply = job.steps.find((s) => s.id === 'apply').run;
    expect(apply.indexOf('cd private-repo')).toBe(0);
    const pushTag = apply.indexOf('git push -f origin refs/tags/backsync-base');
    expect(apply.lastIndexOf('cd ../public-repo', pushTag)).toBeGreaterThan(-1);
    expect(apply.slice(pushTag).indexOf('exit 0')).toBeLessThan(apply.slice(pushTag).indexOf('git push -f origin back-sync'));
    // the open/stale PR checks still query the private repo, now with github.token
    const marker = job.steps.find((s) => s.id === 'marker').run;
    expect(marker).toMatch(/gh pr list -R "\$PRIVATE_REPO" --head back-sync --state open/);
    job.steps.filter((s) => /gh pr /.test(s.run || '')).forEach((s) => {
      (s.run.match(/gh pr [a-z]+[^\n]*/g) || []).forEach((call) => expect(call).toMatch(/-R "\$PRIVATE_REPO"/));
      expect(s.env || {}).not.toHaveProperty('GH_TOKEN');
    });
  });
  it('writes commit subjects to the step summary as inline code without backticks', () => {
    const pending = w.jobs['back-sync'].steps.find((s) => s.id === 'pending').run;
    expect(pending).toContain('\\(.sha) `\\(.subject | gsub("`"; ""))`');
    const summaryLines = Object.values(w.jobs['back-sync'].steps).map((s) => s.run || '').join('\n').split('\n').filter((l) => /GITHUB_STEP_SUMMARY/.test(l));
    summaryLines.filter((l) => /\.subject/.test(l)).forEach((l) => expect(l).toMatch(/`\\\(\.subject \| gsub\("`"; ""\)\)`/));
  });
});

describe('pr-sync.yml', () => {
  const src = read('.github/workflows/pr-sync.yml');
  it('names the branch after the package.json version', () => {
    expect(src).toMatch(/jq -r '\.version' source-repo\/package\.json/);
    expect(src).toMatch(/backsync\.js branch-name/);
    expect(src).not.toMatch(/QUARTER|BASE_BRANCH="2\./);
  });
  it('stops when public commits are not back-synced', () => {
    expect(src).toMatch(/backsync\.js guard dest-repo/);
    expect(src).toMatch(/--head back-sync --state open/);
    expect(src.indexOf('backsync.js guard')).toBeLessThan(src.indexOf('rsync -av --delete'));
  });
  it('fails closed when the public branch list cannot be read', () => {
    expect(src).toMatch(/gh api repos\/\$\{DEST_REPO\}\/branches --paginate --jq '\.\[\]\.name' >/);
    expect(src).not.toMatch(/gh api[^\n]*\| jq/);
    expect(src).toMatch(/grep -qx main "\$RUNNER_TEMP\/public-branches\.txt"/);
  });
  it('fails when the version tag already exists in the public repo', () => {
    const step = yaml.load(src).jobs.sync_and_raise_PR.steps.find((s) => s.id === 'gen_branch');
    expect(step.run).toMatch(/git -C dest-repo rev-parse -q --verify "refs\/tags\/\$VERSION"/);
    expect(step.run).toMatch(/Tag \$VERSION already exists in the public repo: bump package\.json first/);
    expect(step.run.indexOf('refs/tags/$VERSION')).toBeLessThan(step.run.indexOf('branch_name=$VERSION'));
  });
  it('keeps the commit message the back-sync recognises', () => expect(src).toMatch(/Automated sync for \$\{\{ steps\.gen_branch\.outputs\.branch_name \}\}/));
  it('names the private repo once, in an env var', () => {
    const job = yaml.load(src).jobs.sync_and_raise_PR;
    expect(job.env.PRIVATE_REPO).toBe('eacg-gmbh/ts-core-ce');
    job.steps.forEach((s) => expect(s.run || '').not.toMatch(/eacg-gmbh\/ts-core-ce/));
    expect(job.steps.find((s) => s.name === 'Check back-sync').run.match(/-R "\$PRIVATE_REPO"/g)).toHaveLength(2);
  });
});

describe('scan.yml', () => {
  it('runs only in the private repo', () => expect(wf('scan.yml').jobs.scan.if).toBe("github.repository == 'eacg-gmbh/ts-core-ce'"));
  it('passes the version and the token to run through env, with no ${{ }} inside a run', () => {
    const steps = wf('scan.yml').jobs.scan.steps;
    steps.forEach((s) => expect(s.run || '').not.toMatch(/\$\{\{/));
    const scan = steps.find((s) => s.name === 'Scan dependencies');
    expect(scan.env).toEqual({VERSION: '${{ steps.get_version.outputs.VERSION }}', TS_TOKEN: '${{ secrets.TS_TOKEN }}'});
    expect(scan.run).toMatch(/--tag "\$VERSION"/);
    expect(scan.run).toMatch(/--apiKey "\$TS_TOKEN"/);
  });
});

describe('CE_SPRINT_CHECKLIST.md', () => {
  const src = read('.github/CE_SPRINT_CHECKLIST.md');
  it('says to run Back-sync with skip after porting a failed commit by hand', () => expect(src).toMatch(/Back-sync[^.]*by hand[^.]*`skip`/s));
  it('says to merge the sync PR promptly and avoid Update branch', () => {
    expect(src).toMatch(/promptly/);
    expect(src).toMatch(/Update branch/);
  });
});

describe('tag.yml', () => {
  const w = wf('tag.yml');
  it('creates a GitHub Release only in the public repo', () => {
    const step = w.jobs.tag.steps.find((s) => /gh release create/.test(s.run || ''));
    expect(step).toBeDefined();
    expect(step.if).toMatch(/github\.repository == 'TrustSource\/ts-core-ce'/);
    expect(step.run).toMatch(/--generate-notes/);
  });
  it('creates the release whenever the tag has none, not only on the run that pushed the tag', () => {
    const step = w.jobs.tag.steps.find((s) => /gh release create/.test(s.run || ''));
    expect(step.if).not.toMatch(/steps\.create/);
    expect(step.run).toMatch(/if gh release view "\$TAG"/);
    expect(step.run.indexOf('gh release view')).toBeLessThan(step.run.indexOf('gh release create'));
  });
});
