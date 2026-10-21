// CIA requirements (CR, IR, AR) of a module analysis. The project's values are a
// minimum: a module may raise a requirement, never lower it below the project's.
// X (not defined) < L < M < H.
const LEVELS = ['X', 'L', 'M', 'H'];
const FIELDS = ['CR', 'IR', 'AR'];

function rank(value) {
  return LEVELS.indexOf(value);
}

/**
 * @param {Object} [projectCia] {CR, IR, AR}
 * @param {Object} [moduleCia]  {CR, IR, AR}
 * @returns {Object|undefined} a new object; neither argument is changed
 */
export function mergeCiaRequirements(projectCia, moduleCia) {
  if (!projectCia && !moduleCia) {
    return moduleCia;
  }
  const merged = Object.assign({}, projectCia, moduleCia);
  FIELDS.forEach(function (field) {
    const fromProject = projectCia && projectCia[field];
    const fromModule = moduleCia && moduleCia[field];
    merged[field] = rank(fromProject) > rank(fromModule) ? fromProject : (fromModule || fromProject);
    if (merged[field] === undefined) {
      delete merged[field];
    }
  });
  return merged;
}
