const TYPE_OBJECT_ERROR = 'Object must be a non-null object'

function parsePath(path) {
  if (typeof path !== 'string') throw new TypeError('Path must be a string');
  return path.split('.').map(key => (key.match(/^\d+$/) ? parseInt(key, 10) : key));
}

function traversePath(obj, path, createIfMissing = false) {
  const parts = parsePath(path);
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!(key in current)) {
      if (!createIfMissing) return undefined;
      current[key] = (typeof parts[i + 1] === 'number') ? [] : {};
    } else if (typeof current[key] !== 'object' || current[key] === null) {
      throw new TypeError(`Path contains non-object value at '${key}'`);
    }
    current = current[key];
  }

  return { parent: current, finalKey: parts[parts.length - 1] };
}

export const getNestedValue = function (obj, path) {
  if (typeof obj !== 'object' || obj === null) throw new TypeError(TYPE_OBJECT_ERROR);
  return parsePath(path).reduce((o, key) => o && o[key], obj);
}

export const setNestedValue = function (obj, path, value) {
  if (typeof obj !== 'object' || obj === null) throw new TypeError(TYPE_OBJECT_ERROR);
  const { parent, finalKey } = traversePath(obj, path, true);
  if (value === '') {
    delete parent[finalKey];
  } else {
    parent[finalKey] = value;
  }
}

export const addToArray = function (obj, path, value) {
  if (typeof obj !== 'object' || obj === null) throw new TypeError(TYPE_OBJECT_ERROR);
  const { parent, finalKey } = traversePath(obj, path, true);
  if (!Array.isArray(parent[finalKey])) {
    parent[finalKey] = [];
  }
  parent[finalKey].push(value);
}

export const removeFromArray = function (obj, path, index) {
  if (typeof obj !== 'object' || obj === null) throw new TypeError(TYPE_OBJECT_ERROR);
  if (typeof index !== 'number' || index < 0) throw new TypeError('Index must be a non-negative number');
  const { parent, finalKey } = traversePath(obj, path, true);
  if (!Array.isArray(parent[finalKey])) {
    throw new TypeError(`Target at '${path}' is not an array`);
  }
  parent[finalKey].splice(index, 1);
  if (parent[finalKey].length === 0) {
    delete parent[finalKey];
  }
}

