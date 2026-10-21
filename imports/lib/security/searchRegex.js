// User-typed search text as a MongoDB $regex condition.
//
// Concatenating the text into a pattern ('^.*' + text + '.*$') runs it as a
// regular expression: `.` matches everything, an unbalanced `(` or `[` fails the
// query, and a catastrophic pattern burns database CPU. containsTextRegex escapes
// every metacharacter, so the condition is a plain case-insensitive "contains".
//
// CommonJS with no meteor/* imports so Jest can require it directly - the same
// dual-consumption pattern as imports/lib/component/externalUrl.js.

// Longer than any component name, key or vulnerability id a user searches for.
const SEARCH_TEXT_MAX_LENGTH = 200;

// Same character class as Utils.escapeRegex (imports/lib/utils.js).
function escapeRegex(text) {
  return String(text).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// `{$regex, $options: 'i'}` matching values that contain `text` literally, or
// null when `text` is not a non-empty string.
function containsTextRegex(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }
  return {$regex: escapeRegex(text.slice(0, SEARCH_TEXT_MAX_LENGTH)), $options: 'i'};
}

// Never matches: what an empty or non-string search becomes.
const MATCH_NOTHING = '(?!)';

// A RegExp matching any of the search words, or any "quoted phrase", anywhere in a value,
// case-insensitively. The words are split on whitespace, `-`, `:` and the old `*` / `?`
// wildcard characters; every word and phrase is escaped, so the text never runs as a
// pattern. Global, because the highlight helper replaces every match.
function searchTermsRegExp(query) {
  const text = typeof query === 'string' ? query.slice(0, SEARCH_TEXT_MAX_LENGTH) : '';
  const parts = [];
  text.split('"').forEach((segment, index) => {
    if (index % 2 === 1) {
      parts.push(segment);
    } else {
      parts.push(...segment.split(/[\s\-:*?]+/));
    }
  });
  const terms = parts.filter((part) => part.trim() !== '').map(escapeRegex);
  return new RegExp(`(${terms.length ? terms.join('|') : MATCH_NOTHING})`, 'ig');
}

module.exports = {SEARCH_TEXT_MAX_LENGTH, containsTextRegex, escapeRegex, searchTermsRegExp};
