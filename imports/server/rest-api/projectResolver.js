// ---------------------------------------------------------------------------
// One project resolver for every path that turns a project NAME into a project
// document.
//
// `POST /projects` used to insert unconditionally, so re-posting a name that
// already existed built a SECOND project beside the first one. Each site that
// resolves a name then picked between the duplicates its own way - `projects[0]`
// in scans.js, an unordered `findOneAsync` in moduleResolver.js and check.js -
// i.e. whatever order Mongo happened to return. Two uploads naming the same
// project could therefore land under two different rows.
//
// The rule, in one place so that no call site can restate it differently:
//   1. every lookup is scoped to the caller's company
//   2. an `_id` match is authoritative - it addresses exactly one row, so it is
//      never a tie to break and never warns
//   3. otherwise the OLDEST project carrying that exact name wins:
//      `creationDate` ascending, then `_id` ascending
//   4. one warning, from the single place where the comparator had to choose
//
// The names are matched exactly and case-sensitively; nothing here creates a
// project, and nothing here writes.
// ---------------------------------------------------------------------------
import Projects from '/imports/lib/collections/projects';
import {asString} from '/imports/lib/security/sanitizeQuery';
import {normalizeProjectName} from '/imports/lib/project/projectName';

// Force-merged into any caller-supplied projection. A projection does not affect the database
// sort, so the window would still be right, but it does starve the comparator: without
// `creationDate` every candidate reads as undated and the winner silently becomes the lowest
// `_id` instead of the oldest project, and without `_id` the tie-break has nothing left to
// compare and the winner falls back to the row order this module exists to eliminate.
const SORT_FIELDS = {_id: 1, creationDate: 1};

// The database orders on the same two keys, in the same direction, as the `oldestFirst`
// comparator below: the DB decides WHICH rows land in the window, the comparator decides which
// of those wins. For every row this API can write the two agree, so the cap bounds how many
// candidates are looked at and not which one wins - `creationDate` is either a real Date (POST
// /projects stamps one, and cleanAndValidateProject runs the whole ProjectSchema, which types
// the field) or absent, and an ascending BSON sort puts absent first, exactly where the
// comparator's -Infinity puts it.
//
// The two CAN disagree, on one corner that is accepted behaviour rather than a bug. Rows
// written around the schema - imports, migrations and years of older REST clients - can hold a
// `creationDate` that is neither absent nor a Date. The comparator calls every such value
// undated and orders those rows by `_id`; BSON instead sorts by TYPE first, putting null and
// missing ahead of every number, string and object. So once CANDIDATE_LIMIT rows of one name in
// one company carry a null or missing `creationDate`, a string-dated row with a lower `_id`
// sorts outside the window, and the answer is the oldest row IN THE WINDOW rather than the
// oldest of the whole set.
//
// The answer is still deterministic and independent of row order there, which is the property
// that matters: `_id` is unique, so {creationDate, _id} is a total order and the window
// is a function of the data alone, never of the order Mongo happened to return rows in. Only
// the window's contents are capped, not its stability. Reaching this at all takes more than
// CANDIDATE_LIMIT same-named projects inside one company plus a legacy non-Date row, so it is
// left as-is; project-resolution-bounds.unit.spec.js pins the corner as accepted behaviour
// rather than as a defect.
const CANDIDATE_SORT = {creationDate: 1, _id: 1};

// How many same-named projects one lookup will pull into memory. The duplicate-name state
// this module exists to resolve is NOT self-limiting - `Projects.allow({insert})` still lets an
// authorized client insert straight over DDP with no name-uniqueness guard (the rule is in
// imports/server/collections/projects.js; it checks role and company, and nothing else),
// `POST /projects/:id` renames without one, and the check-then-insert in handlePost is not
// atomic - so the set has to be bounded here. 50 is an order of magnitude above the worst
// real duplication the issue found (5 `TEST_SCAN` rows) while keeping the sort a bounded
// top-k rather than a blocking one.
const CANDIDATE_LIMIT = 50;

// The ONE read in this module, and therefore the one place the company has to be
// ANDed in - which is what lets a source-level test assert that every project
// lookup is tenant-scoped (see scan-ingest-contract.unit.spec.js). Both arms of
// findProjectByNameOrId route through here so that guarantee stays a countable one.
//
// The tenant is assigned LAST: it has to WIN a key collision, not lose one, so that a
// `match` which ever grew a `companyId` key could not silently widen the scope of the read.
async function findCandidates(companyId, match, fields, limit = CANDIDATE_LIMIT) {
  const options = {sort: CANDIDATE_SORT, limit: limit};
  if (fields) { options.fields = Object.assign({}, fields, SORT_FIELDS); }
  return await Projects.find(Object.assign({}, match, {companyId: companyId}), options).fetchAsync();
}

// `creationDate` is optional in ProjectSchema, so it can genuinely be absent. A row without
// one sorts FIRST and therefore wins - deliberately the same order an ascending BSON sort
// produces for an ABSENT value, so moving this comparator into the query later, or backing it
// with an index, would not move the winner for any row this API can write. It would move it
// for a legacy row whose `creationDate` is present but not a Date: this counts that as undated
// and BSON does not. See CANDIDATE_SORT above for why that is accepted.
function creationTime(project) {
  const date = project && project.creationDate;
  return date instanceof Date && !isNaN(date.getTime()) ? date.getTime() : -Infinity;
}

function oldestFirst(a, b) {
  const left = creationTime(a);
  const right = creationTime(b);
  if (left !== right) { return left < right ? -1 : 1; }
  if (a._id === b._id) { return 0; }
  return a._id < b._id ? -1 : 1;      // ties break on the id, never on row order
}

// A duplicated name is a STANDING CONDITION, not an event: without this, every scan, SARIF
// upload and /check call naming it logs a line, on exactly the paths that run most often.
// One line per {company, name} per hour still surfaces the condition to an operator without
// letting a single duplicate amplify log volume by the request rate. The map is capped and
// dropped wholesale when it fills, so it cannot grow into a leak.
const WARN_INTERVAL_MS = 60 * 60 * 1000;
const WARN_KEYS_MAX = 500;
const warnedAt = new Map();

function shouldWarn(companyId, name) {
  // A name CAN contain a NUL - ProjectSchema permits control characters, as the log-injection
  // note in resolveUnique below spells out - but a company id cannot, so the FIRST NUL is
  // always the separator and two different {company, name} pairs cannot collide onto one key.
  const key = `${companyId}\u0000${name}`;
  const now = Date.now();
  const last = warnedAt.get(key);
  if (last !== undefined && now - last < WARN_INTERVAL_MS) { return false; }
  if (!warnedAt.has(key) && warnedAt.size >= WARN_KEYS_MAX) { warnedAt.clear(); }
  warnedAt.set(key, now);
  return true;
}

// The single point at which a duplicated name is resolved, and so the single point
// that can warn about one.
function resolveUnique(companyId, name, candidates) {
  if (!candidates.length) { return null; }
  if (candidates.length === 1) { return candidates[0]; }
  const chosen = candidates.slice().sort(oldestFirst)[0];
  if (shouldWarn(companyId, name)) {
    // A full page of candidates means "at least this many": there may be more the cap did not
    // return, or there may be exactly CANDIDATE_LIMIT, and this read cannot tell them apart.
    const count = candidates.length < CANDIDATE_LIMIT ? `${candidates.length}` : `${CANDIDATE_LIMIT}+`;
    // JSON.stringify, not interpolation: ProjectSchema rejects `<`, `>` and backtick in a
    // name but PERMITS \n, \r and \x1b, so an interpolated name could shape extra lines -
    // and a convincing fake log record - into CloudWatch. The company id, the count and the
    // chosen _id are the tenant's own identifiers and stay readable.
    console.warn(`Project name ${JSON.stringify(name)} matches ${count} projects in company`,
      companyId, '- using the oldest', chosen._id);
  }
  return chosen;
}

/**
 * The project a NAME means inside one company.
 *
 * @param  {Object} args
 * @param  {String} args.companyId caller's company - always part of the selector; a missing
 *                                 or non-string company answers null without querying
 * @param  {String} args.name      TRIMMED, then matched exactly; a non-string or an
 *                                 empty-after-trimming name answers null without issuing
 *                                 a query
 * @param  {Object} [args.fields]  projection; the sort keys are merged back in
 * @return {Object|null} the project document, transformed as the collection defines
 */
export async function findProjectByName({companyId, name, fields}) {
  // `companyId` is guarded exactly as the operand beside it is. Every call site takes it from
  // the authenticated key today, but "every read is tenant-scoped" has to hold against a
  // FUTURE one too, and an undefined company reaching the selector would WIDEN the read
  // rather than narrow it.
  const company = asString(companyId);
  // Normalising HERE covers every name->project site in one edit - check.js's two arms,
  // moduleResolver.js (SARIF, BOM import), scans.js and handlePost - because they all
  // come through this function. It fixes the CALLER's untrimmed input against a stored
  // trimmed name, which is the reported bug and is independent of whether any legacy row is
  // itself untrimmed. `normalizeProjectName` answers undefined for a non-string exactly as
  // `asString` does, so the guard below still catches everything it used to; the new case it
  // adds is a name that is empty only AFTER trimming, which can match nothing and so is not
  // worth a round trip.
  const value = normalizeProjectName(name);
  if (!company || !value) { return null; }
  return resolveUnique(company, value,
    await findCandidates(company, {name: value}, fields, CANDIDATE_LIMIT));
}

/**
 * As findProjectByName, but the reference is matched as EITHER a name or an `_id`.
 * An id match wins outright, even over an older project named after that id.
 *
 * @param  {Object} args
 * @param  {String} args.companyId caller's company - always part of the selector; a missing
 *                                 or non-string company answers null without querying
 * @param  {String} args.nameOrId  matched against `_id` RAW, then against `name` trimmed
 * @param  {Object} [args.fields]  projection; the sort keys are merged back in
 * @return {Object|null} the project document, transformed as the collection defines
 */
export async function findProjectByNameOrId({companyId, nameOrId, fields}) {
  const company = asString(companyId);
  const value = asString(nameOrId);
  if (!company || !value) { return null; }
  // The authoritative arm runs FIRST and ON ITS OWN. `_id` addresses at most one row inside
  // one company, so a limit of 1 here is exact rather than a cut - and that is the point of
  // splitting it out of the old single `$or`: the id match can no longer be pushed past a
  // cut it is not part of. Only when it misses does the name arm run, where the cap belongs.
  const byId = await findCandidates(company, {_id: value}, fields, 1);
  if (byId.length) { return byId[0]; }
  // The id arm above deliberately used the RAW value: trimming an id operand would WIDEN the
  // lookup, so `"  abc  "` would start addressing the project `abc` - the opposite of what an
  // authoritative, exact-address arm is for. Only the fallback NAME arm normalises, and an
  // empty-after-trimming name is not worth a second read.
  const named = normalizeProjectName(value);
  if (!named) { return null; }
  return resolveUnique(company, named,
    await findCandidates(company, {name: named}, fields, CANDIDATE_LIMIT));
}

export default {findProjectByName, findProjectByNameOrId};
