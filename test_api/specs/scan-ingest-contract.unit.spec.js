/* eslint-disable no-undef */
// Scan ingestion was duplicated: the REST endpoint (rest-api/scans.js handlePost) and the UI
// import (startup/server/moduleImports.js) each built and inserted their own scan document.
// They drifted - the UI path skipped dependency validation, content notices and the scan-schema
// check entirely. `ingestScan` is now the single implementation, called by both.
//
// Consolidating an ingest path moves an authorization boundary: everything handlePost used to
// do inline now runs inside a function that a second, non-HTTP caller also invokes. The checks
// that gate it (user-agent, API key, key scope) must therefore stay OUTSIDE and BEFORE it, and
// `ingestScan` must keep deriving the tenant from the authenticated caller rather than from the
// request body. Those are the properties asserted here.
//
// Both files pull in Meteor absolute imports and cannot be required under Jest, and the running
// behaviour needs a Meteor server harness this repo's CI does not have (see the report's
// Coverage Gaps). These are therefore structural assertions on the source - comment-stripped,
// so a commented-out check cannot make them pass - plus executable coverage of the two pure
// helpers the UI path added.
const {readSource, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const scansSrc = readSourceWithoutComments('imports/server/rest-api/scans.js');
const importsSrc = readSourceWithoutComments('imports/startup/server/moduleImports.js');

function sliceFunction(src, header, label) {
  const start = src.indexOf(header);
  if (start === -1) throw new Error(`Could not find ${label} ("${header}") - the spec must follow the rename.`);
  // Up to the next top-level `function `/`async function ` declaration.
  const rest = src.slice(start + header.length);
  const nextDecl = rest.search(/\n(?:async )?function [A-Za-z_$]/);
  return rest.slice(0, nextDecl === -1 ? rest.length : nextDecl);
}

const handlePostBody = sliceFunction(scansSrc, 'async function handlePost(', 'handlePost');
const ingestScanBody = sliceFunction(scansSrc, 'async function ingestScan(', 'ingestScan');

describe('ingestScan exists and is shared, not copied', () => {
  it('is exported from the REST module', () => {
    expect(scansSrc).toMatch(/ingestScan:\s*ingestScan/);
    expect(scansSrc).toMatch(/export default RestApiScans/);
  });

  it('the UI import calls it instead of inserting its own scan', () => {
    expect(importsSrc).toMatch(/import RestApiScans from '\/imports\/server\/rest-api\/scans'/);
    expect(importsSrc).toMatch(/RestApiScans\.ingestScan\(/);
  });

  it('the UI import no longer runs a parallel insert/analysis pipeline', () => {
    // Opposite direction: the duplicated implementation must be gone, not merely bypassed.
    expect(importsSrc).not.toMatch(/Scans\.insertAsync\(/);
    expect(importsSrc).not.toMatch(/processScan\(/);
    expect(importsSrc).not.toMatch(/CryptoPropertiesPersistImported\(/);
    expect(importsSrc).not.toMatch(/AiPropertiesPersistImported\(/);
    expect(importsSrc).not.toMatch(/findOrCreateModuleByCompanyIdAndName\(/);
  });

  it('the REST endpoint no longer inlines the pipeline either', () => {
    expect(handlePostBody).toMatch(/await ingestScan\(/);
    expect(handlePostBody).not.toMatch(/Scans\.insertAsync\(/);
    expect(handlePostBody).not.toMatch(/findOrCreateModuleByCompanyIdAndName\(/);
  });
});

describe('the REST path authorizes BEFORE it ingests', () => {
  const callIndex = handlePostBody.indexOf('await ingestScan(');

  it('slicing found the call (guards every ordering assertion below)', () => {
    expect(callIndex).toBeGreaterThan(0);
  });

  it.each([
    ['user-agent evaluation', 'RestApi.evaluateUserAgent('],
    ['API-key resolution', 'RestApi.getKeyMetaAndCompanyByAccountAndApiKey('],
    ['API-key scope check', 'Utils.validateKeyScope(']
  ])('runs %s before calling ingestScan', (_label, marker) => {
    const at = handlePostBody.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(callIndex);
  });

  it.each([
    ['a bad user agent', /userAgentStatus\.error[\s\S]{0,200}?return;/],
    ['a bad API key', /keyMetaAndCompany\.error[\s\S]{0,200}?return;/],
    ['an out-of-scope key', /!Utils\.validateKeyScope\([\s\S]{0,200}?return;/]
  ])('short-circuits with a return on %s, so ingestScan is never reached', (_label, pattern) => {
    const match = handlePostBody.match(pattern);
    expect(match).not.toBeNull();
    expect(handlePostBody.indexOf(match[0])).toBeLessThan(callIndex);
  });

  it('still requires the developer/manager scope specifically', () => {
    expect(handlePostBody).toMatch(/validateKeyScope\(keyMetaAndCompany\.keyMeta,\s*\['developer',\s*'manager'\]\)/);
  });

  it('passes the authenticated company and user as the caller - not anything from the body', () => {
    expect(handlePostBody).toMatch(
      /caller:\s*\{company:\s*keyMetaAndCompany\.company,\s*user:\s*keyMetaAndCompany\.user\}/
    );
  });
});

describe('ingestScan derives the tenant from the caller, never the request body', () => {
  it('takes companyId from the authenticated caller', () => {
    expect(ingestScanBody).toMatch(/const companyId = caller\.company\._id/);
  });

  it('never reads companyId off the submitted body', () => {
    expect(ingestScanBody).not.toMatch(/body\.companyId/);
  });

  // `_.extend(body, {...})` mutates the caller-supplied body. A client-supplied `companyId`
  // survives unless the override object sets it - this is what makes cross-tenant injection
  // impossible on this path.
  it('overwrites companyId on the scan document it builds', () => {
    const extend = ingestScanBody.match(/_\.extend\(body,\s*\{[\s\S]*?\}\)/);
    expect(extend).not.toBeNull();
    expect(extend[0]).toMatch(/companyId:\s*companyId/);
  });

  it('scopes project lookup to that company', () => {
    // Resolution lives in resolveProject(); the tenant must be its first argument and must
    // reach the Mongo selector, wherever the function body happens to sit in the file.
    expect(ingestScanBody).toMatch(/resolveProject\(companyId\s*,/);
    const resolver = sliceFunction(scansSrc, 'async function resolveProject(', 'resolveProject');
    // The id arm still queries here...
    expect(resolver).toMatch(/Projects\.findOneAsync\(\{_id:\s*explicitId,\s*companyId:\s*companyId\}\)/);
    // ...the name arm moved into the shared resolver, and carries the tenant
    // across that boundary rather than losing it there.
    expect(resolver).toMatch(/findProjectByNameOrId\(\{companyId:\s*companyId/);
  });

  it('the shared project resolver reads nothing that is not company-scoped', () => {
    // The assertion above used to read the selector straight out of resolveProject. Four
    // resolution sites now share projectResolver.js, so the guarantee is asserted where it
    // is actually implemented - and for EVERY read the module performs, not just one.
    const resolverSrc = readSourceWithoutComments('imports/server/rest-api/projectResolver.js');
    const reads = [...resolverSrc.matchAll(/Projects\.(?:find|findOneAsync)\(/g)];
    // Exactly one, by design: one query site is what makes "every read is tenant-scoped"
    // a countable property rather than a promise. A count of zero would also mean the
    // comment-stripper swallowed the file, so this cannot pass vacuously.
    expect(reads.length).toEqual(1);
    reads.forEach((read) => {
      // The selector is the first argument; it must name the company before the call closes.
      expect(resolverSrc.slice(read.index, read.index + 160)).toMatch(/companyId:\s*companyId/);
    });
  });

  it('every project-name resolution site goes through that one module', () => {
    // Leaving one endpoint on its own findOneAsync would put the duplicate-name lottery back
    // for that endpoint alone, which is the shape the shared resolver removed.
    //
    // Asserted against the RAW source with line-anchored patterns. That used to be a
    // workaround: readSourceWithoutComments truncated moduleResolver.js, whose header comment
    // contains a `/*` (the path `/imports/scan/*`). `2310f6e8b` fixed the helper - it is a
    // scanner now, and moduleResolver.js goes 182 lines in and 182 lines out - so the
    // workaround is no longer needed. Raw source is kept anyway, because for a NEGATIVE
    // assertion it is the strictly conservative input: a stripper bug can only ever delete
    // code, and deleted code makes a `not.toMatch` pass for free and silently, while raw
    // source can at worst raise a false alarm that somebody has to look at.
    //
    // What makes raw source safe against the other direction - a commented-out line
    // satisfying the negative assertion - is the `^` anchor plus the leading
    // `const|let|var|return`, which a `//`-prefixed line cannot match. And the positive
    // `toMatch` on the import line is what proves the file was read at all, so neither
    // assertion can pass on an empty or misspelled path.
    [
      'imports/server/rest-api/scans.js',
      'imports/server/rest-api/moduleResolver.js',
      'imports/server/rest-api/check.js',
      'imports/server/rest-api/projects.js'
    ].forEach((file) => {
      const src = readSource(file);
      expect(src).toMatch(/^import \{findProjectBy[A-Za-z]+\} from '\.\/projectResolver';$/m);
      // `const project = await Projects.findOneAsync({companyId, name: ...})` - the shape
      // that picked an arbitrary duplicate. Anchored so a commented-out line does not count.
      expect(src).not.toMatch(/^\s*(?:const|let|var|return)[^\n]*Projects\.findOneAsync\(\{companyId,\s*name:/m);
    });
  });

  it('takes the project reference as an explicit argument, never off the body', () => {
    // A caller-supplied `body.projectId` must not be able to steer resolution.
    expect(ingestScanBody).not.toMatch(/body\.projectId/);
    expect(scansSrc).toMatch(/async function ingestScan\(\{[^}]*projectId[^}]*\}\)/);
  });

  it('passes that company through to module resolution and content notices', () => {
    expect(ingestScanBody).toMatch(/getContentNotices\(scan,\s*caller\.company\.privateLicenses\)/);
    // Module resolution moved into the shared resolver - it is the same
    // authenticated company that has to reach it, not anything from the body.
    expect(ingestScanBody).toMatch(/resolveModuleRef\(\{[\s\S]*?companyId:\s*companyId/);
    expect(ingestScanBody).not.toMatch(/companyId:\s*body\./);
  });
});

describe('ingestScan is transport-independent', () => {
  it('never touches an HTTP response object', () => {
    expect(ingestScanBody).not.toMatch(/\bresponse\./);
    expect(ingestScanBody).not.toMatch(/\brequest\./);
  });

  it('reports failure as a result object with a status code, in both failure shapes', () => {
    expect(ingestScanBody).toMatch(/\{ok:\s*false,\s*statusCode:\s*400,\s*context:\s*context\}/);
    expect(ingestScanBody).toMatch(/ok:\s*false,\s*statusCode:\s*404/);
    expect(ingestScanBody).toMatch(/ok:\s*true,\s*\n?\s*statusCode:\s*201/);
  });

  it('validates the scan schema AND the dependencies before doing any work', () => {
    const validateAt = ingestScanBody.indexOf('helpers.cleanAndValidateScan(');
    const depValidateAt = ingestScanBody.indexOf('helpers.cleanAndValidateDependency(');
    const insertAt = ingestScanBody.indexOf('Scans.insertAsync(');
    expect(validateAt).toBeGreaterThan(-1);
    expect(depValidateAt).toBeGreaterThan(validateAt);
    expect(insertAt).toBeGreaterThan(depValidateAt);
  });

  it('the REST wrapper still renders both failure shapes onto the response', () => {
    expect(handlePostBody).toMatch(/if \(result\.context\)/);
    expect(handlePostBody).toMatch(/RestApi\.createErrorResponse\(result\.context/);
    expect(handlePostBody).toMatch(/response\.statusCode = result\.statusCode/);
  });
});

describe('the notification names the module, not the project', () => {
  // Regression: the audit entry and mail body both read "for <project>" because handlePost
  // passed scan.project where sendMailToUser expects the module.
  it('sendMailToUser is handed scan.module', () => {
    expect(ingestScanBody).toMatch(/sendMailToUser\(caller\.user,\s*scan\.module,\s*scanId\)/);
    expect(ingestScanBody).not.toMatch(/sendMailToUser\([^)]*scan\.project/);
  });

  it('the UI import does not write a second, duplicate scanCreated entry', () => {
    // ingestScan already defers sendMailToUser(), which writes that audit record for BOTH
    // routes; the UI import logging it again produced two identical entries per import.
    expect(importsSrc).not.toMatch(/'scanCreated'/);
    expect(importsSrc).not.toMatch(/created for '\+scanBody\.name/);
  });
});

describe('the UI import surfaces the result instead of dropping it', () => {
  it('marks the import ERROR and returns when ingestion fails', () => {
    const failure = importsSrc.slice(importsSrc.indexOf('if (!result.ok)'));
    expect(failure).toMatch(/'meta\.status':\s*'ERROR'/);
    expect(failure.indexOf('return;')).toBeGreaterThan(-1);
    // The success write must not be reachable after a failure.
    expect(failure.indexOf('return;')).toBeLessThan(failure.indexOf("'meta.status': 'FINISHED'"));
  });

  it('stores the dependency warning and content notices on a successful import', () => {
    expect(importsSrc).toMatch(/importUpdate\['meta\.warning'\]/);
    expect(importsSrc).toMatch(/importUpdate\['meta\.contentNotices'\]/);
    expect(importsSrc).toMatch(/importUpdate\['meta\.reason'\]/);
  });

  it('declares an explicit API version rather than inheriting an HTTP header', () => {
    expect(importsSrc).toMatch(/const API_VERSION = 2/);
    expect(importsSrc).toMatch(/apiVersion:\s*API_VERSION/);
  });
});
