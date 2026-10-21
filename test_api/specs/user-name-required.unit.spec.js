/* eslint-disable no-undef */
// Saving the Profile form with an empty Name only showed the generic "Validation
// failed, please ensure you are entering valid data" toast (the SimpleSchema regex
// rejected the empty string), and a whitespace-only Name passed the regex and was
// saved. The Invite form in Users settings writes the same profile.name and had the
// same gaps. Both forms now check the name with one shared helper before saving and
// show a field-level message; the server methods check it too, with the same text.
//
// Source-assertion pattern for the Blaze/server files (they import meteor/* modules
// jest cannot resolve); the helper itself is plain CommonJS and tested directly.
const fs = require('fs');
const path = require('path');
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const {
  userNameProblem,
  normalizeUserName,
  USER_NAME_MESSAGES
} = require('../../imports/lib/user/nameValidation');

function readHtml(relative) {
  return fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
}

describe('userNameProblem', () => {
  it.each(['', '   ', '\t \n', undefined, null])('reports %j as empty', (name) => {
    expect(userNameProblem(name)).toBe('empty');
  });

  it.each(['A', '<script>', 'x'.repeat(51), 42])('reports %j as invalid', (name) => {
    expect(userNameProblem(name)).toBe('invalid');
  });

  it.each(['Anna Schmidt', "O'Brien", '  J. Smith  '])('accepts %j', (name) => {
    expect(userNameProblem(name)).toBeNull();
  });

  it('judges the trimmed value, so padding cannot turn one letter into a valid name', () => {
    expect(userNameProblem(' A ')).toBe('invalid');
  });
});

describe('normalizeUserName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeUserName('  Anna Schmidt \t')).toBe('Anna Schmidt');
  });

  it('turns a non-string into an empty string', () => {
    expect(normalizeUserName(undefined)).toBe('');
  });
});

describe('USER_NAME_MESSAGES', () => {
  it('has a specific message for each problem', () => {
    expect(USER_NAME_MESSAGES.empty).toBe('Enter a name');
    expect(USER_NAME_MESSAGES.invalid).toMatch(/2 to 50/);
    expect(USER_NAME_MESSAGES.empty).not.toMatch(/Validation failed/);
  });
});

describe('Profile form (settings/profile)', () => {
  const js = readSourceWithoutComments('imports/client/ui/settings/profile.js');
  const html = readHtml('imports/client/ui/settings/profile.html');
  const submit = js.slice(js.indexOf("'submit .main'"), js.indexOf("'submit .communication_form'"));

  it('imports the shared helper', () => {
    expect(js).toMatch(/import\s*\{[^}]*\buserNameProblem\b[^}]*\}\s*from\s*'\/imports\/lib\/user\/nameValidation'/);
  });

  it('checks the name before calling the server and stops with a field error', () => {
    const check = submit.indexOf('userNameProblem(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(submit.indexOf("callAsync('updateUserProfile'"));
    expect(submit).toMatch(/Session\.set\('profileEditErrors',\s*\{\s*name:\s*USER_NAME_MESSAGES\[/);
    expect(submit).toMatch(/\[name=name\]'\)\.trigger\('focus'\)|\[name=name\]'\)\.focus\(\)/);
  });

  it('clears the field error and saves the trimmed name', () => {
    expect(submit).toMatch(/Session\.set\('profileEditErrors',\s*\{\s*\}\)/);
    expect(submit).toMatch(/normalizeUserName\(/);
  });

  it('marks the Name field invalid in the existing help-block style', () => {
    expect(html).toMatch(/<div class="controls \{\{errorClass 'name'\}\}">\s*<input name="name" id="name"/);
    expect(html).toMatch(/aria-invalid="\{\{ariaInvalid 'name'\}\}"/);
    expect(html).toMatch(/aria-describedby="profile-name-error"/);
    expect(html).toMatch(/<span class="help-block" id="profile-name-error">\{\{errorMessage 'name'\}\}<\/span>/);
  });
});

describe('Invite form (settings/users)', () => {
  const js = readSourceWithoutComments('imports/client/ui/settings/users/company-users-invites.js');
  const html = readHtml('imports/client/ui/settings/users/company-users-invites.html');

  it('checks the name with the shared helper before inviting', () => {
    expect(js).toMatch(/import\s*\{[^}]*\buserNameProblem\b[^}]*\}\s*from\s*'\/imports\/lib\/user\/nameValidation'/);
    const check = js.indexOf('userNameProblem(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(js.indexOf("callAsync('inviteUser'"));
    expect(js).toMatch(/nameError\.set\(USER_NAME_MESSAGES\[/);
    expect(js).toMatch(/\[name=name\]'\)\.trigger\('focus'\)/);
  });

  it('shows the message under the Name field', () => {
    expect(html).toMatch(/<div class="col-sm-4 controls \{\{nameErrorClass\}\}">/);
    expect(html).toMatch(/aria-invalid="\{\{nameInvalid\}\}"/);
    expect(html).toMatch(/<span class="help-block" id="invite-name-error">\{\{nameError\}\}<\/span>/);
  });
});

describe('server methods reject a missing name with the specific message', () => {
  it('updateUserProfile checks profile.name', () => {
    const src = readSourceWithoutComments('imports/server/collections/users.js');
    const method = src.slice(src.indexOf('updateUserProfile: async function'), src.indexOf('setUserRole: async function'));
    expect(method).toMatch(/userNameProblem\(/);
    expect(method).toMatch(/throw new Meteor\.Error\(400,\s*USER_NAME_MESSAGES\[/);
    expect(method).toMatch(/normalizeUserName\(/);
  });

  it('inviteUser checks the name', () => {
    const src = readSourceWithoutComments('imports/startup/server/accounts.js');
    const method = src.slice(src.indexOf('inviteUser: async function'));
    const check = method.indexOf('userNameProblem(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(method.indexOf('findOneAsync'));
    expect(method).toMatch(/throw new Meteor\.Error\(400,\s*USER_NAME_MESSAGES\[/);
  });
});

describe('Account activation form (account/signup)', () => {
  // The invitation sets a name and prefills the field, but it is still required
  // (jQuery Validate `required`). Validate 1.14 does not trim, so "   " passed
  // `required` and `minlength: 2` and was written to profile.name after activation.
  const js = readSourceWithoutComments('imports/client/ui/account/signup.js');
  const rules = js.slice(js.indexOf('rules:'), js.indexOf('password:'));
  const submit = js.slice(js.indexOf('submitHandler'), js.indexOf('Accounts.resetPassword('));

  it('imports the shared helper', () => {
    expect(js).toMatch(/import\s*\{[^}]*\buserNameProblem\b[^}]*\}\s*from\s*'\/imports\/lib\/user\/nameValidation'/);
  });

  it('registers a validator rule that asks userNameProblem and shows USER_NAME_MESSAGES', () => {
    expect(js).toMatch(/\$\.validator\.addMethod\('userName',\s*function\s*\(value\)\s*\{\s*return userNameProblem\(value\) === null;/);
    expect(js).toMatch(/USER_NAME_MESSAGES\[userNameProblem\(\$\(element\)\.val\(\)\)\]/);
  });

  it('applies the rule to the Name field in place of the untrimmed minlength', () => {
    expect(rules).toMatch(/name:\s*\{[^}]*\buserName:\s*true/);
    expect(rules).not.toMatch(/minlength/);
    expect(js).toMatch(/messages:\s*\{\s*name:\s*\{\s*required:\s*USER_NAME_MESSAGES\.empty/);
  });

  it('writes the trimmed name, not the raw field value', () => {
    expect(submit).toMatch(/const name = normalizeUserName\(\$\('#name'\)\.val\(\)\)/);
  });
});

describe('client write of the own name on activation (deny rule)', () => {
  const {deniesClientProfileWrite} = require('../../imports/lib/interactors/users/protectedProfileFields');
  const ME = 'userAAAAAAAAAAAAA';
  const own = {_id: ME};

  it.each(['', '   ', 'A', '<script>', '  Anna Schmidt ', 42, null])('denies $set profile.name to %j', (name) => {
    expect(deniesClientProfileWrite(ME, own, ['profile'], {$set: {'profile.name': name}})).toBe(true);
  });

  it('allows a valid, already trimmed name', () => {
    expect(deniesClientProfileWrite(ME, own, ['profile'], {$set: {'profile.name': 'Anna Schmidt'}})).toBe(false);
  });

  it('still allows the newsletter flag alone', () => {
    expect(deniesClientProfileWrite(ME, own, ['profile'], {$set: {'profile.newsletter': true}})).toBe(false);
  });
});
