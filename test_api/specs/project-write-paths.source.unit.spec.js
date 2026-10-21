/* eslint-disable no-undef */
// The three ways a project name gets written, and the one way it gets echoed back.
//
// "Trim the project name in all cases" is satisfiable HOLLOWLY by adding `.trim()` to the two
// Blaze submit handlers: every manual test passes while a hand-rolled DDP client still writes
// `"  Storefront  "` straight into the collection - which is exactly the threat model an allow
// rule exists for. So the assertions here are at the SERVER boundary, and they are structural
// because the code they cover is Meteor-coupled registration (`Projects.allow`, Iron Router
// server routes) that cannot be required under Jest and needs a Meteor harness this repo's CI
// does not have. `projects-create-method.unit.spec.js` executes the interactor for real; this
// file pins the wiring around it.
//
// Read comment-stripped, so a commented-out check cannot satisfy a positive assertion. The
// helper is a scanner (see source-comment-stripper.unit.spec.js), and every describe below
// opens with a positive assertion that would fail if the file had been swallowed - so a
// negative assertion here cannot pass vacuously on an empty string.
const fs = require('fs');
const path = require('path');
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const REPO_ROOT = path.join(__dirname, '../..');

const collectionsSrc = readSourceWithoutComments('imports/server/collections/projects.js');
const restSrc = readSourceWithoutComments('imports/server/rest-api/projects.js');
const interactorSrc = readSourceWithoutComments('imports/lib/interactors/projects/create.js');
const startupSrc = readSourceWithoutComments('imports/startup/server/project.js');
const indexSrc = readSourceWithoutComments('imports/lib/interactors/projects/index.js');

/** The text of a `X.allow({ ... });` / function block, from its header to the closing line. */
function sliceBlock(src, header, closer, label) {
  const start = src.indexOf(header);
  if (start === -1) throw new Error(`Could not find ${label} ("${header}") - the spec must follow the rename.`);
  const rest = src.slice(start);
  const end = rest.indexOf(closer);
  if (end === -1) throw new Error(`Could not find the end of ${label} ("${closer}").`);
  return rest.slice(0, end + closer.length);
}

const allowBlock = sliceBlock(collectionsSrc, 'Projects.allow({', '\n});', 'Projects.allow');
const handlePost = sliceBlock(restSrc, 'async function handlePost(', '\n}\n', 'handlePost');
const handleGet = sliceBlock(restSrc, 'async function handleGet(', '\n}\n', 'handleGet');

describe('the client can no longer insert a project straight over DDP', () => {
  it('the allow block was found and still carries its other two arms', () => {
    // The floor for everything below: if this file were swallowed or renamed, these fail
    // rather than letting the `not.toMatch` assertions pass on an empty string.
    expect(allowBlock).toMatch(/update:\s*async function/);
    expect(allowBlock).toMatch(/remove:\s*async function/);
  });

  it('has no insert arm at all', () => {
    // Meteor denies by default when no allow rule matches, so DELETING the arm - rather than
    // making it return false - is what closes the path. Both client create sites now go
    // through the `Projects.Create` method instead.
    expect(allowBlock).not.toMatch(/\binsert\s*:/);
    expect(allowBlock).not.toMatch(/\binsertAsync\s*:/);
  });

  it('the insertion predicate is gone from the file, not merely unreferenced', () => {
    expect(collectionsSrc).not.toMatch(/isInsertionAllowed/);
    // ...and so is the `delete doc._id` that only ever existed to feed it. `Projects` has a
    // transform and the rule never passed `transform: null`, so the callback was handed an
    // EJSON clone whose `_id` is always set - the delete could not affect the stored document,
    // and WITHOUT it `if (!doc._id)` would always have been false and no client insert would
    // ever have been permitted at all.
    expect(allowBlock).not.toMatch(/delete doc\._id/);
  });

  it('keeps the shared role/company check the update and remove arms still need', () => {
    expect(collectionsSrc).toMatch(/async function checkRoleAndCompany\(doc\)/);
    expect(allowBlock).toMatch(/update:[\s\S]*?await checkRoleAndCompany\(doc\)/);
    expect(allowBlock).toMatch(/remove:[\s\S]*?await checkRoleAndCompany\(doc\)/);
  });
});

describe('the surviving DDP write path normalises the name before it validates it', () => {
  it('imports the one definition of a normalised name', () => {
    expect(collectionsSrc).toMatch(
      /^import \{normalizeProjectName\} from '\/imports\/lib\/project\/projectName';?$/m);
  });

  it('normalises the modifier IN PLACE, before isModificationAllowed sees it', () => {
    // The AutoForm rename on Project Settings > General (`updateProjectForm`) is a SHIPPED
    // feature that writes this modifier over DDP. Fixing only create would relocate the
    // defect instead of removing it.
    //
    // In place is not a shortcut here: allow-deny's `_validatedUpdateAsync` hands the SAME
    // `mutator` object to every validator and then passes that object to the driver's
    // updateAsync, so the trimmed value is what gets written. It is also the mechanism
    // collection2 itself uses (its `firstDeny` comment reads "Referenced modifier is cleaned
    // in place").
    expect(allowBlock).toMatch(/modifier\.\$set\.name\s*=\s*normalizeProjectName\(/);
    const normalizeAt = allowBlock.indexOf('normalizeProjectName(');
    const validateAt = allowBlock.indexOf('isModificationAllowed(');
    expect(normalizeAt).toBeGreaterThan(-1);
    expect(validateAt).toBeGreaterThan(-1);
    // Order is the whole point: normalising AFTER the validator would validate one value and
    // store another, and normalising after the rule returned would not run at all.
    expect(normalizeAt).toBeLessThan(validateAt);
  });

  it('only assigns when the incoming value is a string', () => {
    // `normalizeProjectName` answers undefined for a non-string, and the Meteor driver runs
    // with `ignoreUndefined: true` - so assigning it would DROP the key from the modifier and
    // turn a rejected rename into a silent success that changed nothing. Leaving the value
    // untouched keeps `validateOne` free to reject it.
    expect(allowBlock).toMatch(/typeof modifier\.\$set\.name === 'string'/);
  });
});

describe('the REST update echo is a whitelist, shared with the read endpoint', () => {
  it('declares the projection exactly once, at module level', () => {
    const declarations = [...restSrc.matchAll(/const PROJECT_API_FIELDS\b/g)];
    // Two arms echoing the same document is how they drifted in the first place: handleGet
    // projected, the update arm did not, and the update arm returned jira/tfs/github
    // credentials plus relatedUsers to a `developer`-scoped key. One constant is what stops
    // them re-forking.
    expect(declarations.length).toEqual(1);
    expect(restSrc).toMatch(/^const PROJECT_API_FIELDS = \{/m);
  });

  it('is what BOTH the single-project read and the update read-back use', () => {
    expect(handleGet).toMatch(/fields:\s*PROJECT_API_FIELDS/);
    expect(handlePost).toMatch(/fields:\s*PROJECT_API_FIELDS/);
  });

  it('leaves no unprojected project read anywhere in handlePost', () => {
    // The finding this closes: `Projects.findOneAsync({_id, companyId})` with NO second
    // argument, JSON.stringify'd straight onto the response. Asserted over EVERY read the
    // handler makes, not just the echo, so a future one cannot reintroduce the shape.
    const reads = [...handlePost.matchAll(/Projects\.findOneAsync\(/g)];
    expect(reads.length).toBeGreaterThan(0);
    reads.forEach((read) => {
      expect(handlePost.slice(read.index, read.index + 220)).toMatch(/fields\s*:/);
    });
  });

  it('is a whitelist: no credential or ownership field can be added to it by accident', () => {
    const projection = sliceBlock(restSrc, 'const PROJECT_API_FIELDS = {', '};', 'PROJECT_API_FIELDS');
    // An EXCLUSION list fails open - the next integration field added to ProjectSchema would
    // leak by default. These five are the ones that must never be echoed.
    ['jira', 'tfs', 'github', 'relatedUsers', 'companyId'].forEach((field) => {
      expect(projection).not.toMatch(new RegExp(`\\b${field}\\s*:`));
    });
  });

  it('still carries every settings field an in-repo spec reads back', () => {
    const projection = sliceBlock(restSrc, 'const PROJECT_API_FIELDS = {', '};', 'PROJECT_API_FIELDS');
    // projects.spec.js asserts these on a POST /projects/:id or GET /projects/:id response.
    // Narrowing the echo must not narrow the read-modify-write contract API clients depend on.
    ['name', 'description', 'requireWhitelist', 'licenseConfig', 'componentConfig',
      'cveConfig', 'obligationConfig', 'legalRulesConfig', 'requirements', 'ciaRequirements',
      'endoflifePolicy', 'autoCreateCweRisks', 'tags',
      'confidenceMinScore'].forEach((field) => {
      expect(projection).toMatch(new RegExp(`\\b${field}\\s*:\\s*1`));
    });
  });
});

describe('Projects.Create is wired as a server method and stays out of the client bundle', () => {
  it('exists as an interactor beside its siblings and exports a default', () => {
    expect(interactorSrc).toMatch(/export default create/);
    expect(indexSrc).toMatch(/^export \{default as ProjectsCreate\} from '\.\/create'/m);
  });

  it('is registered under the name the client calls', () => {
    expect(startupSrc).toMatch(/'Projects\.Create':\s*ProjectsCreate/);
    expect(startupSrc).toMatch(/\bProjectsCreate\b[\s\S]*?from '\/imports\/lib\/interactors\/projects'/);
  });

  it('reuses the #136 resolver instead of writing a second {companyId, name} lookup', () => {
    expect(interactorSrc).toMatch(
      /^import \{findProjectByName\} from '\/imports\/server\/rest-api\/projectResolver';?$/m);
    // A second lookup would be a second place for the tenant scope and the tie-break rule to
    // drift, and `scan-ingest-contract.unit.spec.js` counts the resolver's reads for exactly
    // that reason.
    expect(interactorSrc).not.toMatch(/Projects\.(?:find|findOne|findOneAsync)\(/);
  });

  it('takes the tenant from the session and never from its arguments', () => {
    expect(interactorSrc).toMatch(/await Meteor\.userAsync\(\)/);
    expect(interactorSrc).not.toMatch(/args\.companyId/);
    expect(interactorSrc).toMatch(/\['manager', 'compliance_manager'\]/);
  });

  // The interactor index lives under imports/lib (shared code), but `create.js` now imports a
  // module under imports/server - which Meteor excludes from the CLIENT bundle. If any
  // client-reachable file imported the index, the client build would break on a missing
  // module. Nothing may import it outside imports/startup/server.
  it('the interactor index is imported only from imports/startup/server', () => {
    const roots = ['imports', 'client', 'server', 'packages'];
    const referencing = [];
    let scanned = 0;

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
        } else if (entry.name.endsWith('.js')) {
          scanned++;
          const src = fs.readFileSync(full, 'utf8');
          if (/from '\/imports\/lib\/interactors\/projects'/.test(src)) {
            referencing.push(path.relative(REPO_ROOT, full));
          }
        }
      }
    }
    roots.forEach((root) => walk(path.join(REPO_ROOT, root)));

    // Floors, so neither an empty sweep nor an empty result set can pass for free.
    expect(scanned).toBeGreaterThan(500);
    expect(referencing.length).toBeGreaterThan(0);
    referencing.forEach((file) => {
      expect(file.startsWith('imports/startup/server/')).toBe(true);
    });
  });
});
