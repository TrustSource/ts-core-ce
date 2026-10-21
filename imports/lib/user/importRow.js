// Papa Parse (header:true) emits a trailing object whose every value is an empty
// string for the final newline of a CSV. Such a row is not a user: it must be
// skipped by both the user import and its preview so it is neither invited nor
// counted as a validation error. Plain CommonJS with no imports so the server
// methods (imports/server/collections/users.js) and Jest share one definition.
function isBlankImportRow(row) {
  return !row || typeof row !== 'object' || Object.keys(row).every(function (key) {
    return row[key] == null || String(row[key]).trim() === '';
  });
}

module.exports = {isBlankImportRow};
