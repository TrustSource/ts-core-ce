import Projects from '/imports/lib/collections/projects';

// WHO may administer a webhook receiver, and WHERE one may be filed.
//
// The role list was spelled three times - the create interactor, the collection's
// allow rule, and the two publications that hand out the
// receiver's credentials. Three copies of an authorisation list is three chances
// for one of them to drift, so it is declared once here.
export const WEBHOOK_ADMIN_ROLES = ['account_admin', 'manager', 'compliance_manager'];

/**
 * May a webhook carrying this `projectId` be filed by this company?
 *
 * A row with no projectId is a COMPANY-level receiver, which is legitimate - so
 * an absent value is allowed and only a present one is checked. A present value
 * that is not a string is refused rather than interpolated: this is a field in a
 * Mongo selector, and `{$gt: ''}` here would match the first project of any
 * company.
 *
 * Nothing DELIVERS to a mismatched row today (every dispatch selector carries
 * companyId, so a foreign row is simply never selected), which is why this reads
 * as housekeeping rather than an exfiltration fix. It stops rows being planted
 * where the owning company will never see them: the project settings tab lists
 * by subscription, so a receiver filed against a foreign project id is invisible
 * to the tenant it belongs to and still counts against them.
 *
 * @param {String} [projectId] the projectId on the row being created
 * @param {String} companyId   the caller's company, already resolved
 * @returns {Promise<Boolean>}
 */
export async function projectBelongsToCompany(projectId, companyId) {
  if (projectId === undefined || projectId === null || projectId === '') {
    return true;
  }
  if (typeof projectId !== 'string' || typeof companyId !== 'string' || !companyId) {
    return false;
  }
  return !!await Projects.findOneAsync({_id: projectId, companyId}, {fields: {_id: 1}});
}
