// Input rules for InfrastructureComponents.Create.
//
// That method is the only write path that adds a component to the shared
// `infrastructureComponents` catalog, so these rules stand between a DDP client and the
// catalog every company on the install reads: each field is type-checked and bounded,
// and a field that is not listed is refused rather than ignored.
//
// Plain CommonJS with no imports, so Jest requires it directly and both bundles can
// carry it.

const INFRASTRUCTURE_COMPONENT_KEY_PREFIX = 'im:';

const INFRASTRUCTURE_COMPONENT_LIMITS = {
  name: 200,
  key: 200,
  url: 2000,
  version: 100,
  versionCount: 200
};

const DUPLICATE_KEY_MESSAGE = 'An infrastructure component with this key already exists';
const DUPLICATE_NAME_MESSAGE = 'An infrastructure component with this name already exists';

const FIELDS = ['name', 'key', 'versions', 'homepage', 'repository'];
const URL_PATTERN = /^https?:\/\/\S+$/i;
const KEY_PATTERN = /^im:\S+$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * The stored form of an infrastructure component key: trimmed, lowercased, and carrying
 * the `im:` prefix that tells the key apart from package-manager keys.
 *
 * @param {*} value
 * @returns {{value: String}|{error: String}}
 */
function normalizeInfrastructureComponentKey(value) {
  if (typeof value !== 'string') {
    return {error: 'Invalid key'};
  }
  let key = value.trim().toLowerCase();
  if (key.indexOf(INFRASTRUCTURE_COMPONENT_KEY_PREFIX) !== 0) {
    key = INFRASTRUCTURE_COMPONENT_KEY_PREFIX + key;
  }
  if (key.length > INFRASTRUCTURE_COMPONENT_LIMITS.key || !KEY_PATTERN.test(key)) {
    return {error: 'Invalid key'};
  }
  return {value: key};
}

function validateName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return {error: 'Name is required'};
  }
  const name = value.trim();
  if (name.length > INFRASTRUCTURE_COMPONENT_LIMITS.name) {
    return {error: 'Name is too long'};
  }
  return {value: name};
}

// Comma-separated, as the create form takes them. Blank entries and repeats are dropped,
// so an empty field adds no version rather than one without a number.
function validateVersions(value) {
  if (isBlank(value)) {
    return {value: []};
  }
  if (typeof value !== 'string') {
    return {error: 'Invalid versions'};
  }
  const seen = new Set();
  const versions = [];
  const parts = value.split(',');
  for (let i = 0; i < parts.length; i++) {
    const version = parts[i].trim();
    if (!version || seen.has(version)) {
      continue;
    }
    if (version.length > INFRASTRUCTURE_COMPONENT_LIMITS.version) {
      return {error: 'A version is too long'};
    }
    seen.add(version);
    versions.push({version: version});
  }
  if (versions.length > INFRASTRUCTURE_COMPONENT_LIMITS.versionCount) {
    return {error: 'Too many versions'};
  }
  return {value: versions};
}

function validateUrl(value, label) {
  if (isBlank(value)) {
    return {};
  }
  const error = {error: 'Invalid ' + label + ' URL'};
  if (typeof value !== 'string') {
    return error;
  }
  const url = value.trim();
  if (url.length > INFRASTRUCTURE_COMPONENT_LIMITS.url || !URL_PATTERN.test(url)) {
    return error;
  }
  return {value: url};
}

/**
 * Validate the input of InfrastructureComponents.Create.
 *
 * A blank key is left out of `doc`: the caller derives it from the name.
 *
 * @param {*} input {name, key?, versions?, homepage?, repository?}
 * @returns {{error: String}|{doc: {name, key?, versions: Array<{version}>, urls: Object}}}
 */
function validateInfrastructureComponentInput(input) {
  if (!isPlainObject(input)) {
    return {error: 'Invalid component'};
  }
  const unknown = Object.keys(input).find(function (field) {
    return FIELDS.indexOf(field) === -1;
  });
  if (unknown !== undefined) {
    return {error: 'Unknown field: ' + unknown};
  }
  const name = validateName(input.name);
  if (name.error) {
    return name;
  }
  const doc = {name: name.value};
  if (!isBlank(input.key)) {
    const key = normalizeInfrastructureComponentKey(input.key);
    if (key.error) {
      return key;
    }
    doc.key = key.value;
  }
  const versions = validateVersions(input.versions);
  if (versions.error) {
    return versions;
  }
  doc.versions = versions.value;
  doc.urls = {};
  const links = ['homepage', 'repository'];
  for (let i = 0; i < links.length; i++) {
    const url = validateUrl(input[links[i]], links[i]);
    if (url.error) {
      return url;
    }
    if (url.value) {
      doc.urls[links[i]] = url.value;
    }
  }
  return {doc: doc};
}

/**
 * An exact, case-insensitive matcher for a stored key or name.
 *
 * @param {String} value
 * @returns {RegExp}
 */
function sameValuePattern(value) {
  return new RegExp('^' + String(value).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '$', 'i');
}

module.exports = {
  INFRASTRUCTURE_COMPONENT_KEY_PREFIX,
  INFRASTRUCTURE_COMPONENT_LIMITS,
  DUPLICATE_KEY_MESSAGE,
  DUPLICATE_NAME_MESSAGE,
  normalizeInfrastructureComponentKey,
  validateInfrastructureComponentInput,
  sameValuePattern
};
