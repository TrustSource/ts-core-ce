import semver from 'semver'; // use node module semver

const SemverExt = {
  isValid: function (v) {
    return semver.valid(v) !== null;
  },

  valid: function (v) {
    return semver.valid(v);
  },

  compare: function (a, b, lenient) {
    return lenient ?
      compare(makeValid(a), makeValid(b))
      :
      compare(a, b);
  },

  arraySortByVersion: function (versions, propName) {
    if (versions instanceof Array) {
      propName = propName || 'version';
      versions.sort((a, b) => sort(a, b, propName));
    }
    return versions;
  },

  arraySortByVersionDesc: function (versions, propName) {
    if (versions instanceof Array) {
      propName = propName || 'version';
      versions.sort((first, second) => sort(second, first, propName));
    }
    return versions;
  }
};

function sort(a, b, propName) {
  if (a && a[propName] && b && b[propName]) {
    return SemverExt.compare(a[propName], b[propName], true);
  } else if (a && a[propName]) {
    return +1;
  } else if (b && b[propName]) {
    return -1;
  }
  return 0;
}
function makeValid(a) {
  return semver.valid(a) || semver.valid(a + '.0') || semver.valid(a + '.0.0') || a;
}

function compare(a, b) {
  if (a === b) {
    return 0;
  }
  if (semver.valid(a) !== null && semver.valid(b) !== null) {
    // valid version numbers, use semver.gt() method (greater than)
    return semver.gt(a, b) ? 1 : -1;
  } else if (semver.valid(a) !== null) {
    return 1;
  } else if (semver.valid(b) !== null) {
    return -1;
  } else {
    // invalid version number -> basic text sort
    const lessOrEqual = a < b ? -1 : 0;
    return a > b ? 1 : lessOrEqual;
  }
}

export default SemverExt;
