// Input rules for the "Company details" form (General info settings page): company name,
// company email and logo URL. `Companies.UpdateDetails` writes only what this returns.
//
// validateCompanyDetails(input) -> {error: String} | {set: Object, unset: Array<String>}
//   - input must be a plain object holding no key other than name, email and logoUrl;
//   - name: required, trimmed, 1-200 characters, no markup characters (the rule the company
//     schema has always carried for a name);
//   - email, logoUrl: optional; a missing, null or blank value is listed in `unset`,
//     anything else is trimmed and checked.
//
// Plain CommonJS with no imports so the server method and Jest share one implementation.

const FIELDS = ['name', 'email', 'logoUrl'];

const NAME_MAX = 200;
const EMAIL_MAX = 254;
const LOGO_URL_MAX = 2000;

// Backtracking stays negligible: the value is capped at EMAIL_MAX characters before it is tested.
// eslint-disable-next-line sonarjs/slow-regex
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_URL_RE = /^https?:\/\/\S+$/i;
// Same two patterns as `name` in imports/lib/schemas/companySchema.js.
const NAME_NO_ANGLE_BRACKETS_RE = /^[^<>]*$/;
// eslint-disable-next-line sonarjs/regex-complexity
const NAME_NO_SCRIPT_RE = /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/;

// Realm-independent: a DDP argument, a Jest object and Object.create(null) all pass;
// arrays, dates and class instances do not.
function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function validateCompanyDetails(input) {
  if (!isPlainObject(input)) {
    return {error: 'Invalid company details'};
  }
  const unknown = Object.keys(input).find((key) => FIELDS.indexOf(key) === -1);
  if (unknown !== undefined) {
    return {error: 'Unknown field: ' + unknown};
  }

  const set = {};
  const unset = [];

  if (typeof input.name !== 'string' || input.name.trim() === '') {
    return {error: 'Company name is required'};
  }
  const name = input.name.trim();
  if (name.length > NAME_MAX) {
    return {error: 'Company name is too long'};
  }
  if (!NAME_NO_ANGLE_BRACKETS_RE.test(name) || !NAME_NO_SCRIPT_RE.test(name)) {
    return {error: 'Company name contains invalid characters'};
  }
  set.name = name;

  if (isBlank(input.email)) {
    unset.push('email');
  } else {
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
      return {error: 'Invalid company email'};
    }
    set.email = email;
  }

  if (isBlank(input.logoUrl)) {
    unset.push('logoUrl');
  } else {
    const logoUrl = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';
    if (!logoUrl || logoUrl.length > LOGO_URL_MAX || !LOGO_URL_RE.test(logoUrl)) {
      return {error: 'Invalid logo URL'};
    }
    set.logoUrl = logoUrl;
  }

  return {set, unset};
}

module.exports = {validateCompanyDetails};
