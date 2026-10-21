/* eslint-disable no-undef */
// Unit tests for the client-side pre-checks that gate the architecture.md
// upload flow (acceptance criteria 3 & 7):
//   isArchitectureFileExtensionValid(fileName) - .md/.markdown only
//   isArchitectureFileSizeValid(fileSize)      - <= PROJECT_DESCRIPTION_MAX
// both exported from imports/client/ui/project/project-settings.js.
//
// WHY this is not a plain `require(...)` of the source file: that module
// imports 'meteor/meteor', 'meteor/templating', 'meteor/aldeed:autoform', jQuery,
// etc, and uses ES `import`/`export` syntax. This repo's jest.config.js has no
// babel transform registered (confirmed empirically: requiring the file
// verbatim throws "Cannot use import statement outside a module" before ever
// reaching a Meteor-resolution error), and there is no jsdom/Blaze harness here
// (see the .frontend.unit.spec.js precedents for component-details-edit.js and
// approve-generation-progress.js, which fall back to source-text pattern
// matching for that reason).
//
// Unlike those precedents, isArchitectureFileExtensionValid/
// isArchitectureFileSizeValid are genuinely pure and dependency-free (they only
// close over two small module-level constants), so a plain text-pattern match
// would be a strictly weaker test than what's achievable here. Instead: extract
// the REAL function source verbatim via regex (not retyped/reimplemented) and
// evaluate it in a minimal vm sandbox that supplies just those two constants -
// this actually EXECUTES the shipped logic (case-folding, boundary condition,
// non-number rejection), not merely its shape. If the extraction regex ever
// stops matching (e.g. the functions are renamed/moved), the setup throws
// immediately and every test in this file fails loudly rather than silently
// passing on stale/absent code.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '../../imports/client/ui/project/project-settings.js');
const HTML_PATH = path.join(__dirname, '../../imports/client/ui/project/project-settings.html');
const SCHEMA_PATH = path.join(__dirname, '../../imports/lib/schemas/projectSchema.js');
const raw = fs.readFileSync(SRC_PATH, 'utf8');
const htmlRaw = fs.readFileSync(HTML_PATH, 'utf8');
const schemaRaw = fs.readFileSync(SCHEMA_PATH, 'utf8');

function must(match, label) {
  if (!match) {
    throw new Error(`project-settings-architecture-upload.frontend.unit.spec.js: could not locate ${label} in ` +
      'project-settings.js/projectSchema.js - has it been renamed or restructured?');
  }
  return match;
}

// PROJECT_DESCRIPTION_MAX is imported by project-settings.js from
// projectSchema.js (the single shared client/server cap, per the Interface
// Contract) - extract the SAME literal from its actual source rather than
// hard-coding 102400, so this suite can't silently drift from the real cap.
const maxExpr = must(schemaRaw.match(/export const PROJECT_DESCRIPTION_MAX\s*=\s*(.+?);/), 'PROJECT_DESCRIPTION_MAX')[1];
const extConstExpr = must(raw.match(/const ARCHITECTURE_FILE_EXTENSIONS\s*=\s*(\[[^\]]*\])/), 'ARCHITECTURE_FILE_EXTENSIONS')[1];
const getFileExtensionSrc = must(raw.match(/function getFileExtension\([^)]*\)\s*\{[\s\S]*?\n\}/), 'getFileExtension')[0];
const isExtValidSrc = must(raw.match(/export function isArchitectureFileExtensionValid[\s\S]*?\n\}/), 'isArchitectureFileExtensionValid')[0]
  .replace('export ', '');
const isSizeValidSrc = must(raw.match(/export function isArchitectureFileSizeValid[\s\S]*?\n\}/), 'isArchitectureFileSizeValid')[0]
  .replace('export ', '');

const sandboxSrc = `
  const ARCHITECTURE_FILE_EXTENSIONS = ${extConstExpr};
  const PROJECT_DESCRIPTION_MAX = ${maxExpr};
  ${getFileExtensionSrc}
  ${isExtValidSrc}
  ${isSizeValidSrc}
  module.exports = {
    isArchitectureFileExtensionValid,
    isArchitectureFileSizeValid,
    getFileExtension,
    PROJECT_DESCRIPTION_MAX
  };
`;

const sandbox = {module: {exports: {}}, exports: {}};
vm.createContext(sandbox);
vm.runInContext(sandboxSrc, sandbox, {filename: SRC_PATH});

const {
  isArchitectureFileExtensionValid,
  isArchitectureFileSizeValid,
  PROJECT_DESCRIPTION_MAX
} = sandbox.module.exports;

describe('#76 isArchitectureFileExtensionValid - client-side extension gate (AC3)', () => {
  it('accepts a plain .md file', () => {
    expect(isArchitectureFileExtensionValid('architecture.md')).toBe(true);
  });

  it('accepts a plain .markdown file', () => {
    expect(isArchitectureFileExtensionValid('architecture.markdown')).toBe(true);
  });

  it('is case-insensitive on the extension (.MD)', () => {
    expect(isArchitectureFileExtensionValid('ARCHITECTURE.MD')).toBe(true);
  });

  it('is case-insensitive on the extension (.Markdown)', () => {
    expect(isArchitectureFileExtensionValid('notes.Markdown')).toBe(true);
  });

  it('rejects .txt', () => {
    expect(isArchitectureFileExtensionValid('architecture.txt')).toBe(false);
  });

  it('rejects a double extension that disguises a script as markdown (.md.exe)', () => {
    expect(isArchitectureFileExtensionValid('architecture.md.exe')).toBe(false);
  });

  it('accepts a filename with unrelated dots as long as the LAST extension is .md', () => {
    expect(isArchitectureFileExtensionValid('archive.tar.md')).toBe(true);
  });

  it('rejects a file with no extension at all', () => {
    expect(isArchitectureFileExtensionValid('architecture')).toBe(false);
  });

  it('rejects an empty filename', () => {
    expect(isArchitectureFileExtensionValid('')).toBe(false);
  });

  it('rejects a null/undefined filename rather than throwing', () => {
    expect(isArchitectureFileExtensionValid(undefined)).toBe(false);
    expect(isArchitectureFileExtensionValid(null)).toBe(false);
  });

  it('rejects a bare dotfile with nothing after the dot (e.g. ".md" typed as a hidden-file name)', () => {
    // lastIndexOf('.') === 0 -> extension is the whole string '.md', which IS
    // in the allow-list, so a file literally named ".md" is accepted - document
    // this real edge-case behavior explicitly rather than assume it's rejected.
    expect(isArchitectureFileExtensionValid('.md')).toBe(true);
  });
});

describe('#76 isArchitectureFileSizeValid - client-side size cap gate (AC7)', () => {
  it('accepts a small file well under the cap', () => {
    expect(isArchitectureFileSizeValid(1024)).toBe(true);
  });

  it('accepts a file exactly at the cap (boundary, inclusive)', () => {
    expect(isArchitectureFileSizeValid(PROJECT_DESCRIPTION_MAX)).toBe(true);
  });

  it('rejects a file exactly one byte over the cap (boundary)', () => {
    expect(isArchitectureFileSizeValid(PROJECT_DESCRIPTION_MAX + 1)).toBe(false);
  });

  it('accepts a zero-byte file', () => {
    expect(isArchitectureFileSizeValid(0)).toBe(true);
  });

  it('rejects a non-number size (string)', () => {
    expect(isArchitectureFileSizeValid('12345')).toBe(false);
  });

  it('rejects an undefined size rather than throwing', () => {
    expect(isArchitectureFileSizeValid(undefined)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isArchitectureFileSizeValid(NaN)).toBe(false);
  });

  it('confirms the cap matches the shared PROJECT_DESCRIPTION_MAX constant (100KB)', () => {
    expect(PROJECT_DESCRIPTION_MAX).toBe(100 * 1024);
  });
});

// AC1: "an Upload file button appears directly above the Application goals
// field, visible/enabled under the same condition that already governs the
// field itself." The button (imports/client/ui/project/project-settings.html)
// is wrapped in the SAME {{#with hasFieldRight 'project.general.description'
// currentProject}} block as the description afQuickField - but its own
// `disabled` attribute is NOT driven by that context's `disabled` property.
// It calls a separate helper, architectureUploadDisabled (project-settings.js),
// which checks UserExtUtils.hasAccessRight('project.general', 'w', project) -
// the COARSER, section-level permission (any writable field under "general"),
// not the field-level 'project.general.description' key that governs the
// textarea's own read-only state via hasFieldRight.
//
// This is only a real bug if some shipped role's permission tree can make
// those two checks disagree - proven below using the REAL permission data and
// resolution logic from imports/lib/userExtUtils.js (UserExtUtils.allRoles,
// hasAccessRight, and its private helpers), extracted verbatim and evaluated
// in a vm sandbox with Meteor/Roles stubbed to a single-role fake user (the
// same technique used above for the pure functions). This does NOT reimplement
// the permission model - it runs the actual shipped resolution code.
describe('#76 AC1 - upload button enablement vs the Application goals field\'s own permission gate', () => {
  const userExtRaw = fs.readFileSync(path.join(__dirname, '../../imports/lib/userExtUtils.js'), 'utf8');

  function sliceSrc(marker, endMarker) {
    const start = userExtRaw.indexOf(marker);
    if (start === -1) throw new Error(`Could not find "${marker}" in userExtUtils.js`);
    const end = userExtRaw.indexOf(endMarker, start);
    if (end === -1) throw new Error(`Could not find "${endMarker}" after "${marker}" in userExtUtils.js`);
    return userExtRaw.slice(start, end);
  }

  const allRolesSrc = sliceSrc('UserExtUtils.allRoles = function () {', '\nUserExtUtils.availableRoles = function () {');
  const permissionHelpersSrc = sliceSrc('function arrayToUnique(list) {', '\nUserExtUtils.username = function');

  const userExtSandboxSrc = `
    const UserExtUtils = {};
    const Meteor = {isClient: true, user: () => sandboxFakeUser};
    const Roles = {getRolesForUser: () => sandboxFakeUser.__roles};
    ${allRolesSrc}
    ${permissionHelpersSrc}
    module.exports = {UserExtUtils, setFakeUser: (u) => { sandboxFakeUser = u; }};
  `;
  const userExtSandbox = {module: {exports: {}}, sandboxFakeUser: null};
  vm.createContext(userExtSandbox);
  vm.runInContext(userExtSandboxSrc, userExtSandbox, {filename: 'userExtUtils.js'});
  const {UserExtUtils, setFakeUser} = userExtSandbox.module.exports;

  // The field-level permission key: extracted from the {{#with hasFieldRight
  // '...' currentProject}} block that ACTUALLY wraps the upload button in the
  // real HTML (the nearest such wrap preceding the button), not assumed.
  const buttonIdx = htmlRaw.indexOf('action-upload-architecture');
  const withRe = /\{\{#with hasFieldRight '([^']+)' currentProject\}\}/g;
  let wm; let fieldLevelKey = null; let nearestIdx = -1;
  while ((wm = withRe.exec(htmlRaw))) {
    if (wm.index < buttonIdx && wm.index > nearestIdx) {
      nearestIdx = wm.index;
      fieldLevelKey = wm[1];
    }
  }
  // The permission key architectureUploadDisabled ACTUALLY checks: extracted
  // from its real helper body, not assumed.
  const buttonKey = must(
    raw.match(/architectureUploadDisabled:\s*function\s*\(\)\s*\{[\s\S]*?\n  \},/),
    'architectureUploadDisabled helper'
  )[0].match(/hasAccessRight\('([^']+)'/)[1];

  it('sanity check: the button IS wrapped in the field-level project.general.description gate', () => {
    expect(fieldLevelKey).toBe('project.general.description');
  });

  it('locks the button to the SAME field-level permission key as the description field (AC1 fix)', () => {
    // Was 'project.general' (coarser, section-level) - a real bug found by this
    // suite: for 'account_admin'/'portfolio_manager' it let the button show
    // enabled while the description field itself was read-only (see the
    // role-based test.each below). Fixed to check the identical key the field
    // itself uses, so this now asserts the fix stays in place rather than
    // characterizing the old bug.
    expect(buttonKey).toBe('project.general.description');
    expect(buttonKey).toBe(fieldLevelKey);
  });

  // For every real, shipped role, on a freshly-created project (no
  // relatedUsers assigned yet - Projects.Insert's actual initial shape), the
  // button's enabled/disabled state must match the field's own read-only
  // state. AC1 requires this explicitly ("the SAME condition that already
  // governs the field itself").
  const roleKeys = UserExtUtils.allRoles().map((r) => r.key);
  const freshProjectEntity = {}; // no relatedUsers assigned - a brand-new project

  it('exercises at least the full known role set (sanity check - not 0 roles)', () => {
    expect(roleKeys.length).toBeGreaterThan(0);
  });

  test.each(roleKeys)('role "%s": button-enabled state matches the description field\'s own writable state', (roleKey) => {
    setFakeUser({_id: 'u1', profile: {companyId: 'c1'}, __roles: [roleKey]});
    const fieldIsWritable = UserExtUtils.hasAccessRight(fieldLevelKey, 'w', freshProjectEntity);
    const buttonWouldBeEnabled = UserExtUtils.hasAccessRight(buttonKey, 'w', freshProjectEntity);
    // Regression lock for a real bug this suite found and frontend-dev fixed:
    // 'account_admin' and 'portfolio_manager' each have a NESTED sub-field
    // under project.general with 'w' access (account_admin: leanix='rw';
    // portfolio_manager: relatedUsers.defaultProjectManager/
    // defaultComplianceManager='rw') while `description` itself is 'r'-only
    // for both - so before the fix, the then-coarser section-level check the
    // button used returned true (enabled) while the field itself was
    // read-only. Now that architectureUploadDisabled checks the same
    // field-level key as the textarea, this passes for every role; it stays
    // here so a future regression back to the coarser key is caught.
    expect(buttonWouldBeEnabled).toBe(fieldIsWritable);
  });
});
