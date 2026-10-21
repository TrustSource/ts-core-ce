/* eslint-disable no-undef */
// A hard reload of a signed-in page used to log "Meteor.Error 401 Authentication required"
// (console: "errorClass"): the layout and list pages called company-scoped methods from
// onCreated / onRendered while the stored login token was still resuming. Meteor.userId() is
// restored from localStorage before that handshake completes, so it reads truthy while the
// DDP connection is still anonymous, and the server's security guard refuses the call.
//
// Each call below has to wait for the resume: either inside an autorun that returns early on
// `Meteor.loggingIn() || !Meteor.userId()` (both reactive, so the autorun re-runs and calls
// once login lands), or inside the `if (user && user.profile)` branch of an autorun keyed on
// Meteor.user(), which is null until the server has published the signed-in user.
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const LOGIN_GUARD = 'if (Meteor.loggingIn() || !Meteor.userId()) return;';
const USER_GUARD = 'if (user && user.profile) {';

// Index of the brace that closes the block opened at `openAt` (which must point at a `{`).
function closingBrace(src, openAt) {
  let depth = 0;
  for (let i = openAt; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// The `this.autorun(function () { ... })` body that contains `at`, or null.
function enclosingAutorun(src, at) {
  let from = src.lastIndexOf('this.autorun(', at);
  while (from > -1) {
    const open = src.indexOf('{', from);
    const close = closingBrace(src, open);
    if (open < at && close > at) return {open, close};
    from = src.lastIndexOf('this.autorun(', from - 1);
  }
  return null;
}

function callSites(src, needle) {
  const sites = [];
  let at = src.indexOf(needle);
  while (at > -1) {
    sites.push(at);
    at = src.indexOf(needle, at + 1);
  }
  return sites;
}

function expectLoginGuarded(src, at) {
  const autorun = enclosingAutorun(src, at);
  expect(autorun).not.toBeNull();
  const before = src.slice(autorun.open, at);
  expect(before).toContain(LOGIN_GUARD);
}

function expectUserGuarded(src, at) {
  const autorun = enclosingAutorun(src, at);
  expect(autorun).not.toBeNull();
  const guardAt = src.lastIndexOf(USER_GUARD, at);
  expect(guardAt).toBeGreaterThan(autorun.open);
  const blockOpen = guardAt + USER_GUARD.length - 1;
  expect(closingBrace(src, blockOpen)).toBeGreaterThan(at);
}

const LOGIN_GUARDED = [
  ['project list', 'imports/client/ui/project/project-list.js', "Meteor.callAsync('getCompanyTags')"],
  ['module list', 'imports/client/ui/module/module-list/module-list.js', "Meteor.callAsync('getCompanyTags')"],
  ['right bar (layout)', 'imports/client/ui/common/right-bar.js', "Meteor.callAsync('getCompanyAccountAdmin')"]
];

describe.each(LOGIN_GUARDED)('%s waits for the login resume', (label, file, call) => {
  const src = readSourceWithoutComments(file);

  it(`calls ${call} only from an autorun gated on loggingIn and userId`, () => {
    const sites = callSites(src, call);
    expect(sites.length).toBeGreaterThan(0);
    sites.forEach((at) => expectLoginGuarded(src, at));
  });
});

describe('policy notification (layout) waits for the login resume', () => {
  const src = readSourceWithoutComments('imports/client/ui/policy/policy-notification.js');

  it('the on-render fetch of getLastPolicyUpdates runs in a gated autorun', () => {
    const onRenderedAt = src.indexOf('Template.policyNotification.onRendered(');
    expect(onRenderedAt).toBeGreaterThan(-1);
    const onRenderedEnd = closingBrace(src, src.indexOf('{', onRenderedAt));
    const sites = callSites(src, 'getLastPolicy();')
      .filter((at) => at > onRenderedAt && at < onRenderedEnd);
    expect(sites.length).toBe(1);
    expectLoginGuarded(src, sites[0]);
  });
});

const USER_GUARDED = [
  ['project settings', 'imports/client/ui/project/project-settings.js'],
  ['module settings', 'imports/client/ui/module/module-settings/module-settings.js']
];

describe.each(USER_GUARDED)('%s waits for the signed-in user', (label, file) => {
  const src = readSourceWithoutComments(file);

  it("calls getCompanyTags only inside the autorun's signed-in branch", () => {
    const sites = callSites(src, "Meteor.callAsync('getCompanyTags')");
    expect(sites.length).toBeGreaterThan(0);
    sites.forEach((at) => expectUserGuarded(src, at));
  });
});
