import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import {ProjectSchema} from '/imports/lib/schemas/projectSchema';
import {normalizeProjectName} from '/imports/lib/project/projectName';
import {findProjectByName} from '/imports/server/rest-api/projectResolver';

// Creating a project from the UI.
//
// Both client sites - the Projects list modal and the scan-import "new project"
// option - used to call `Projects.insertAsync` straight over DDP, gated only by
// `Projects.allow({insert})`. An allow rule cannot do what this needs:
//   - it never saw an untrimmed name as a problem, so a hand-rolled DDP client
//     could store `"  Storefront  "` beside `"Storefront"` - re-creating exactly
//     the duplicate state the shared name lookup exists to arbitrate, at the
//     boundary that lookup did not close;
//   - it compared a CLIENT-SUPPLIED `doc.companyId` against the caller's own
//     company, so the tenant of a create was a request field with a check bolted
//     beside it rather than a value derived from the session;
//   - it returns a boolean, so it could not answer "that name is taken" - the
//     client's own duplicate check reads a `relatedUsers`-filtered Minimongo and
//     is blind to projects the user cannot see.
//
// 409 here is a HARD refusal, deliberately asymmetric with the REST create arm's
// idempotent `200 {existing: true}`. A CI job re-posting a name wants the project
// that is already there; a human clicking "Create project" is about to navigate
// into whatever comes back (or import a file into it), and silently handing them
// somebody else's project is the worse failure. `uniqueSuffix` is for the callers
// that genuinely want "a new one, name it whatever is free" - scan-import, which
// generates `New project`, `New project 2`, ... and so must never see a 409.
//
// This file imports from imports/server/, which Meteor excludes from the CLIENT
// bundle, so imports/lib/interactors/projects/index.js must stay imported only
// from imports/startup/server/* - project-write-paths.source.unit.spec.js sweeps
// the repo for that.

// Same role set the deleted allow rule used - neither widened nor narrowed.
// Widening it would be a privilege change smuggled in under a normalisation fix.
const CREATE_ROLES = ['manager', 'compliance_manager'];

// How far ` 2`, ` 3`, ... will be walked before giving up. Each attempt is one
// indexed read, and the caller is a person waiting on a modal, so the search has
// to be bounded rather than "until it finds one". 50 matches CANDIDATE_LIMIT in
// projectResolver.js - past that many same-named projects in one company, the
// answer is an operator problem and not another suffix.
const MAX_NAME_ATTEMPTS = 50;

const GENERIC_NAME_ERROR = 'Invalid project name';

// The same predicate the removed `isInsertionAllowed()` applied - `name` and
// `creationDate` through ProjectSchema - against the NORMALISED name, so a name
// that is only valid because of its padding (a two-character name typed as
// `" ab "` reads as four) is rejected rather than stored trimmed and short.
function assertValidDocument(name, creationDate) {
  const context = ProjectSchema.newContext();
  if (!context.validateOne({name: name}, 'name')) {
    // The schema's own message, so the modal can show why. `keyErrorMessage`
    // answers '' when it cannot find the key, and a Meteor.Error with an empty
    // reason tells the user nothing, hence the fallback.
    throw new Meteor.Error(400, context.keyErrorMessage('name') || GENERIC_NAME_ERROR);
  }
  if (!context.validateOne({creationDate: creationDate}, 'creationDate')) {
    throw new Meteor.Error(400, context.keyErrorMessage('creationDate') || GENERIC_NAME_ERROR);
  }
}

/**
 * The first name in `name`, `name 2`, `name 3`, ... that no project of this
 * company holds. Without `uniqueSuffix` only the first candidate is considered
 * and a taken one is refused outright.
 *
 * Uniqueness is asked of the SHARED resolver rather than of a second
 * `{companyId, name}` query: one read site is what makes "every project lookup
 * is tenant-scoped" a countable property (scan-ingest-contract.unit.spec.js),
 * and a second lookup would be a second place for that scope - and for the
 * duplicate tie-break - to drift.
 */
async function findFreeName(companyId, name, uniqueSuffix, creationDate) {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? name : `${name} ${attempt}`;
    // Re-validated per candidate: a 199-character name plus ` 2` is over the
    // schema's 200 cap, and the insert would then fail with whatever the driver
    // says instead of a 400 the caller can act on.
    assertValidDocument(candidate, creationDate);
    const existing = await findProjectByName({companyId: companyId, name: candidate, fields: {_id: 1}});
    if (!existing) { return candidate; }
    if (uniqueSuffix !== true) {
      throw new Meteor.Error(409, 'A project with this name already exists');
    }
  }
  throw new Meteor.Error(500, 'Could not create project');
}

/**
 * Create a project inside the caller's own company.
 *
 * @param  {Object}  args
 * @param  {String}  args.name           the requested name; stored trimmed
 * @param  {Boolean} [args.uniqueSuffix] append ` 2`, ` 3`, ... instead of refusing a
 *                                       taken name (the scan-import flow)
 * @return {Object}  {projectId, name} - `name` is the STORED one, which is not the
 *                   requested one when `uniqueSuffix` had to choose
 */
const create = async function (args) {
  // Checked before anything else, and by type rather than by truthiness: a
  // non-object `args` would make every `args.x` below read as undefined and turn
  // a malformed call into a confusing 403 or 400 further down.
  if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.name !== 'string') {
    throw new Meteor.Error(400, 'Invalid arguments');
  }
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  // The tenant comes from the session, never from `args`. The allow rule this
  // replaces compared a client-supplied `doc.companyId` against the caller's own
  // - a check that only worked because it was remembered.
  if (!companyId || !await Roles.userIsInRole(user, CREATE_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const creationDate = new Date();
  const name = await findFreeName(companyId, normalizeProjectName(args.name), args.uniqueSuffix, creationDate);
  // Built field by field, never merged from `args`: ProjectSchema marks `_id`
  // optional, so a caller-chosen id would otherwise be honoured, and every other
  // project setting has its own authorized method.
  const doc = await Meteor.callAsync('setRelatedUsers', user._id, {
    name: name,
    companyId: companyId,
    creationDate: creationDate
  });
  const projectId = await Projects.insertAsync(doc);
  if (!projectId) {
    throw new Meteor.Error(500, 'Could not create project');
  }
  // Moved here from the allow rule, where it ran BEFORE the write and so recorded
  // creates that a later deny or a failed insert never made. It names the STORED
  // project, so a `uniqueSuffix` rename is auditable.
  await Meteor.callAsync('logEvent', user, 'New project ' + name + ' created ', 'projectCreated');
  return {projectId: projectId, name: name};
};

export default create;
