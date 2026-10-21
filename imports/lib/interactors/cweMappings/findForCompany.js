import CweMappings from '/imports/lib/collections/cweMappings';

// Every mapping that applies to one company: its own candidates plus the global
// defaults. `{companyId: null}` matches a document whose companyId
// is null and one that carries none at all, so a default written either way is
// found.
//
// Server-side read used by the REST layer, which has no subscription. The client
// gets the same set through the `cweMappings` publication.
//
// The string check is the tenancy lock, not a convenience: `companyId` goes
// straight into the selector, so a caller that ever passed an object through -
// `{$ne: ''}`, `{$exists: true}` - would read every tenant's mappings at once.
// Today's only caller hands over the company behind the API key, but this is an
// exported interactor and the next caller may not.
const findForCompany = async function (companyId) {
  if (typeof companyId !== 'string' || !companyId) {
    return [];
  }
  // Only what the overlay resolves a rule with. `userName`, `createdBy` and
  // `status` are deliberately absent: on a global default they name a
  // TrustSource-internal curator, and nothing outside ts-app-admin has business
  // reading that.
  return await CweMappings.find({$or: [{companyId}, {companyId: null}]},
    {fields: {tool: 1, ruleId: 1, cwes: 1, companyId: 1}}).fetchAsync();
};

export default findForCompany;
