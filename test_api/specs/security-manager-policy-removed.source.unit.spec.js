/* eslint-disable no-undef */
// The Security manager policy confirmation dialog on Vulnerability activity is gone: the
// generic "New policy updates" modal and the Critical Components component-manager notification
// are untouched and keep using their own methods.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '');
}

function walk(dir, out) {
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') { return; }
      walk(rel, out);
    } else if (entry.isFile() && /\.(js|html)$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

describe('security manager policy dialog removed', () => {
  it('the dialog template, its script and the linked PDFs are deleted', () => {
    expect(fs.existsSync(path.join(REPO,
      'imports/client/ui/vulnerability-activity/report-security-manager-notification.html'))).toBe(false);
    expect(fs.existsSync(path.join(REPO,
      'imports/client/ui/vulnerability-activity/report-security-manager-notification.js'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'public/NV2406_SecMgrRole.pdf'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'public/NV2406_SecMgrRole_En.pdf'))).toBe(false);
  });

  it('the server method behind the dialog is gone', () => {
    expect(live('imports/server/collections/policy.js')).not.toMatch(/getLastSecurityManagerPolicyUpdates/);
  });

  it('no file under imports references the removed dialog, method or its PDFs', () => {
    const offenders = walk('imports', []).filter((rel) =>
      /getLastSecurityManagerPolicyUpdates|reportSecurityManagerNotification|companySecurityManagerPolicy|NV2406/
        .test(live(rel)));
    expect(offenders).toEqual([]);
  });

  // The Vulnerability activity page that hosted the dialog was removed later as a whole
  // (vulnerability-activity-removed.source.unit.spec.js).
  it('positive anchor: the generic policy method that stays is still present', () => {
    expect(live('imports/server/collections/policy.js')).toMatch(/getLastPolicyUpdates/);
  });
});
