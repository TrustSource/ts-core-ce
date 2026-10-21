// Input rules for the license catalog write methods, Licenses.Create and
// Licenses.Update.
//
// Those methods are the only write path to the shared `licenses` collection, so
// these rules are what stands between a DDP client and the catalog every company
// on the install reads: each field is type-checked and bounded, and a field that is
// not listed is refused rather than ignored, so an update can never write `key` or
// any other stored field.
//
// Plain CommonJS with no imports, so Jest requires it directly and both bundles can
// carry it.

const LICENSE_EDITOR_ROLES = ['company_component_manager'];

const DUPLICATE_KEY_MESSAGE = 'A license with this key already exists';

const LICENSE_INPUT_LIMITS = {
  key: 100,
  name: 200,
  url: 2000,
  aliasLength: 200,
  aliasCount: 50,
  text: 256 * 1024,
  copyright: 2000
};

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

const UPDATE_FIELDS = ['name', 'url', 'aliases', 'text', 'copyright'];
const CREATE_FIELDS = ['key'].concat(UPDATE_FIELDS);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function validateKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return {error: 'License key is required'};
  }
  const key = value.trim();
  if (key.length > LICENSE_INPUT_LIMITS.key) {
    return {error: 'License key is too long'};
  }
  if (!KEY_PATTERN.test(key)) {
    return {error: 'License key may only contain letters, digits, ".", "+" and "-", ' +
      'and must start with a letter or digit'};
  }
  return {value: key};
}

function validateName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return {error: 'License name is required'};
  }
  const name = value.trim();
  if (name.length > LICENSE_INPUT_LIMITS.name) {
    return {error: 'License name is too long'};
  }
  return {value: name};
}

function validateUrl(value) {
  if (isBlank(value)) {
    return {cleared: true};
  }
  if (typeof value !== 'string') {
    return {error: 'Invalid URL'};
  }
  const url = value.trim();
  if (url.length > LICENSE_INPUT_LIMITS.url || !URL_PATTERN.test(url)) {
    return {error: 'Invalid URL'};
  }
  return {value: url};
}

function validateAliases(value) {
  if (value === undefined || value === null) {
    return {cleared: true};
  }
  if (!Array.isArray(value)) {
    return {error: 'Invalid aliases'};
  }
  if (value.length > LICENSE_INPUT_LIMITS.aliasCount) {
    return {error: 'Too many aliases'};
  }
  const seen = new Set();
  const aliases = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      return {error: 'Invalid aliases'};
    }
    const alias = value[i].trim();
    if (!alias) {
      continue;
    }
    if (alias.length > LICENSE_INPUT_LIMITS.aliasLength) {
      return {error: 'An alias is too long'};
    }
    if (!seen.has(alias)) {
      seen.add(alias);
      aliases.push(alias);
    }
  }
  return aliases.length ? {value: aliases} : {cleared: true};
}

function validateText(value) {
  if (isBlank(value)) {
    return {cleared: true};
  }
  if (typeof value !== 'string') {
    return {error: 'Invalid license text'};
  }
  if (value.length > LICENSE_INPUT_LIMITS.text) {
    return {error: 'License text is too long'};
  }
  // Untrimmed: leading indentation and trailing newlines are part of a license text.
  return {value: value};
}

function validateCopyright(value) {
  if (isBlank(value)) {
    return {cleared: true};
  }
  if (typeof value !== 'string') {
    return {error: 'Invalid copyright'};
  }
  const copyright = value.trim();
  if (copyright.length > LICENSE_INPUT_LIMITS.copyright) {
    return {error: 'Copyright is too long'};
  }
  return {value: copyright};
}

const VALIDATORS = {
  key: validateKey,
  name: validateName,
  url: validateUrl,
  aliases: validateAliases,
  text: validateText,
  copyright: validateCopyright
};

/**
 * Validate the input of Licenses.Create or Licenses.Update.
 *
 * An update replaces every editable field: an optional field the caller omits or
 * leaves empty is reported in `cleared`, and the update unsets it.
 *
 * @param {*} input the caller's object
 * @param {String} mode 'create' | 'update'
 * @returns {{error: String}|{doc: Object, cleared: Array<String>}}
 */
function validateLicenseInput(input, mode) {
  const fields = mode === 'create' ? CREATE_FIELDS : UPDATE_FIELDS;
  if (!isPlainObject(input)) {
    return {error: 'Invalid license'};
  }
  const unknown = Object.keys(input).find(function (field) {
    return fields.indexOf(field) === -1;
  });
  if (unknown !== undefined) {
    return {error: 'Unknown field: ' + unknown};
  }
  const doc = {};
  const cleared = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const result = VALIDATORS[field](input[field]);
    if (result.error) {
      return {error: result.error};
    }
    if (result.cleared) {
      cleared.push(field);
    } else {
      doc[field] = result.value;
    }
  }
  return {doc: doc, cleared: cleared};
}

/**
 * An exact, case-insensitive matcher for a license key. License matching compares
 * keys lowercased, so two keys that differ only in case would be one license to it.
 *
 * @param {String} key
 * @returns {RegExp}
 */
function sameKeyPattern(key) {
  return new RegExp('^' + String(key).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '$', 'i');
}

/**
 * The identifiers (key, name, aliases) of a license, lowercased. Non-string entries
 * are skipped rather than throwing, since `others` comes straight from the database.
 *
 * @param {{key, name, aliases}} license
 * @returns {Array<String>}
 */
function lowercasedIdentifiers(license) {
  const identifiers = [];
  if (typeof license.key === 'string') {
    identifiers.push(license.key.toLowerCase());
  }
  if (typeof license.name === 'string') {
    identifiers.push(license.name.toLowerCase());
  }
  if (Array.isArray(license.aliases)) {
    license.aliases.forEach(function (alias) {
      if (typeof alias === 'string') {
        identifiers.push(alias.toLowerCase());
      }
    });
  }
  return identifiers;
}

/**
 * The first identifier of `candidate` (its key, name or any alias) that another
 * license already uses as its key, name or alias, compared ignoring case.
 *
 * @param {{key: String, name: String, aliases: Array<String>}} candidate
 * @param {Array<{key, name, aliases}>} others every other license (never the one being updated)
 * @returns {{value: String, key: String}|null} the clashing value and the other license's key
 */
function findIdentifierClash(candidate, others) {
  const candidateValues = [];
  if (typeof candidate.key === 'string') {
    candidateValues.push(candidate.key);
  }
  if (typeof candidate.name === 'string') {
    candidateValues.push(candidate.name);
  }
  if (Array.isArray(candidate.aliases)) {
    candidate.aliases.forEach(function (alias) {
      if (typeof alias === 'string') {
        candidateValues.push(alias);
      }
    });
  }
  for (let i = 0; i < candidateValues.length; i++) {
    const value = candidateValues[i];
    const lowered = value.toLowerCase();
    for (let j = 0; j < others.length; j++) {
      const other = others[j];
      if (lowercasedIdentifiers(other).indexOf(lowered) !== -1) {
        return {value: value, key: other.key};
      }
    }
  }
  return null;
}

/**
 * The refusal message for a clash returned by findIdentifierClash.
 *
 * @param {{value: String, key: String}} clash
 * @returns {String}
 */
function identifierClashMessage(clash) {
  return '"' + clash.value + '" is already used by license ' + clash.key;
}

module.exports = {
  DUPLICATE_KEY_MESSAGE,
  LICENSE_EDITOR_ROLES,
  LICENSE_INPUT_LIMITS,
  findIdentifierClash,
  identifierClashMessage,
  sameKeyPattern,
  validateLicenseInput
};
