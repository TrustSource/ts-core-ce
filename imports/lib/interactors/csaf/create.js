import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {Session} from 'meteor/session';
import CSAF from '/imports/lib/collections/csaf';
import Companies from '/imports/lib/collections/companies';
const {extractTlp} = require('/imports/lib/csaf/feedAccess');

// Who may create a CSAF document. The two role sets already applied to CSAF
// work disagree, and neither is a superset of the other, so this is their union:
//   - `csaf/update.js` and `csaf/remove.js` (server-side, on the same document):
//       compliance_manager, company_security_manager, account_admin
//   - the client-side `Create CSAF` action in report-vulnerability.js:
//       manager, company_security_manager
// Picking either one alone would lock out someone who legitimately creates CSAF
// documents today, so the union is what adds a server-side check without
// removing a working flow.
export const CSAF_CREATE_ROLES = ['manager', 'compliance_manager', 'company_security_manager', 'account_admin'];

const create = async function ({file, name, apiUser}) {
  const submitted = new Date();
  // The tenant a CSAF is written to is derived from the authenticated
  // principal, never from a client argument. `apiUser` arrives over the wire
  // (vex.js sends `Meteor.user()` evaluated in the BROWSER), so it is only a
  // fallback for callers that genuinely have no DDP session - REST routes and
  // server-internal code. When a DDP session exists it wins, otherwise a forged
  // apiUser could redirect both the insert and the logEvent attribution into
  // another company. Same ordering as the sibling `csaf/update.js`.
  let user = await Meteor.userAsync();
  const isSessionUser = !!user;
  if (!isSessionUser) {
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser;
  }
  const companyIdentifier = user.profile && user.profile.companyId;
  if (!companyIdentifier) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // The role check runs here, not only in the browser, so an authenticated user
  // without a CSAF role cannot create documents over raw DDP. The scope is the
  // tenant derived above, so this can never be satisfied against somebody else's
  // company. Skipped when there is no session at all, because an api-key caller
  // has no role assignment to check - the same split `csaf/update.js` makes.
  if (isSessionUser &&
    !await Roles.userIsInRole(user._id, CSAF_CREATE_ROLES, companyIdentifier)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  // `providerId` must name the SAME tenant the document is written to. Nothing
  // downstream re-checks it - `CSAF.allow` enforces only `companyId` - and
  // ts-csaf.js spends it directly: it is the key the advisory-number sequence
  // is counted over, so a wrong one draws numbers from another tenant's series
  // and can collide on the provider. Resolving the company from `Session` FIRST
  // could disagree with the
  // tenant derived above: that is the browser's cached `getCompanyCurrent`
  // result, and `changeCompany` reloads only the tab that switched, so any other
  // open tab keeps a company whose provider is no longer this user's.
  // The cache is validated rather than deleted because this interactor also runs
  // IN THE BROWSER - csaf-import-modal.js imports and calls it directly - and
  // the /csaf route does not subscribe to `company`, so minimongo holds no
  // Companies row there and the cached document is the only place the client can
  // read providerId from; dropping it would silently downgrade every browser
  // import to the companyIdentifier fallback below. On the server `Session` is
  // undefined, so this always resolves the row.
  const cachedCompany = Session && Session.get('company');
  const company = (cachedCompany && cachedCompany._id === companyIdentifier)
    ? cachedCompany
    : await Companies.findOneAsync(companyIdentifier);
  if(file){
    const testFile = {
      submitted,
      companyId: companyIdentifier,
      providerId: (company && company.providerId) || companyIdentifier,
      data: JSON.stringify(file),
      name,
      category: file.document && file.document.category,
      tlp: extractTlp(file),
      status: 'DRAFT'
    };
    const testId = await CSAF.insertAsync(testFile);
    await Meteor.callAsync('logEvent', user, testId, 'csafCreated');
    return testId
  }else {
    throw new Meteor.Error(400, 'CSAF file not found');
  }
};

export default create;
