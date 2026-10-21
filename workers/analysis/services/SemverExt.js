import semver from 'semver';

let SemverExt = {

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
  }
};

function sort(a, b, propName) {
  if (a[propName] && b[propName]) {
    return SemverExt.compare(a[propName], b[propName], true);
  } else if (a[propName]) {
    return +1;
  } else if (b[propName]) {
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
    return semver.gt(a, b) ? 1 : -1;
  } else if (semver.valid(a) !== null) {
    return 1;
  } else if (semver.valid(b) !== null) {
    return -1;
  } else {
    if(a > b){
      return 1;
    }
    return a < b ? -1 : 0
  }
}

export {
  SemverExt
};

