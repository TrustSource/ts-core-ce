/* eslint-disable no-undef */
// Community files for the public repository: support, contributing, security, roadmap,
// issue forms and the maintainer's sprint checklist.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../..');
// The README is tracked as Readme.md; match the case on case-sensitive file systems too.
const read = (file) => {
  const full = path.join(ROOT, file);
  if (file === 'README.md' && !fs.existsSync(full)) return fs.readFileSync(path.join(ROOT, 'Readme.md'), 'utf8');
  return fs.readFileSync(full, 'utf8');
};

const FILES = ['SUPPORT.md', 'CONTRIBUTING.md', 'SECURITY.md', 'ROADMAP.md', '.github/CE_SPRINT_CHECKLIST.md', '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/question.yml', '.github/ISSUE_TEMPLATE/config.yml'];

it.each(FILES.concat('README.md'))('%s has no em-dash or en-dash', (f) => expect(read(f)).not.toMatch(/[–—]/));
it('README links the community files', () => ['SUPPORT.md', 'CONTRIBUTING.md', 'SECURITY.md', 'ROADMAP.md'].forEach((f) => expect(read('README.md')).toContain(`(${f})`)));
it('ROADMAP lists the six releases in order', () => {
  const src = read('ROADMAP.md');
  const at = ['1.1.0', '2.0.0', '2.1.0', '2.2.0', '2.3.0', '3.0.0'].map((v) => src.indexOf(v));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  ['Registry', 'Deep scan', 'Mass scans', 'Algorithms', 'OBOM', 'IDM'].forEach((f) => expect(src).toContain(f));
});
it('SUPPORT states the response times', () => { const s = read('SUPPORT.md'); expect(s).toContain('5 working days'); expect(s).toContain('no SLA'); });
it('SECURITY points to private vulnerability reporting', () => expect(read('SECURITY.md')).toContain('Report a vulnerability'));
it('CONTRIBUTING states AGPL and no CLA', () => { const s = read('CONTRIBUTING.md'); expect(s).toContain('AGPL-3.0'); expect(s).toMatch(/no CLA/i); });
it('issue forms are valid and blank issues are off', () => {
  ['bug_report', 'feature_request', 'question'].forEach((n) => { const f = yaml.load(read(`.github/ISSUE_TEMPLATE/${n}.yml`)); expect(f.name).toBeTruthy(); expect(Array.isArray(f.body)).toBe(true); });
  expect(yaml.load(read('.github/ISSUE_TEMPLATE/config.yml')).blank_issues_enabled).toBe(false);
  // GitHub adds its own "Report a security vulnerability" entry when private reporting is on.
  expect(yaml.load(read('.github/ISSUE_TEMPLATE/config.yml')).contact_links.map((l) => l.name)).not.toContain('Report a security vulnerability');
});
it('the bug form asks for the version and how CE runs', () => { const s = read('.github/ISSUE_TEMPLATE/bug_report.yml'); expect(s).toMatch(/version/i); expect(s).toMatch(/Docker/); });
it('the question form warns about the same secrets as the bug form', () => {
  const warning = (n) => yaml.load(read(`.github/ISSUE_TEMPLATE/${n}.yml`)).body[0].attributes.value.replace(/\s+/g, ' ');
  const items = ['passwords', 'API keys', '`TS_ENCRYPTION_KEY`', 'the contents of `.env`', 'email addresses',
    'names of projects and components that are confidential'];
  items.forEach((i) => { expect(warning('bug_report')).toContain(i); expect(warning('question')).toContain(i); });
});
it('the question form uses the same warning sentence as the bug form', () => {
  const warning = (n) => yaml.load(read(`.github/ISSUE_TEMPLATE/${n}.yml`)).body[0].attributes.value.replace(/\s+/g, ' ');
  const sentence = /Issues are public\. Before you post logs or screenshots, remove secrets and personal data: .*?confidential\./;
  expect(warning('bug_report')).toMatch(sentence);
  expect(warning('question')).toContain(warning('bug_report').match(sentence)[0]);
});
it('the bug form gives the current version as the example', () => {
  const version = yaml.load(read('.github/ISSUE_TEMPLATE/bug_report.yml')).body.find((b) => b.id === 'version');
  expect(version.attributes.description).toContain('for example 1.0.3.');
});
