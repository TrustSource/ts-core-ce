import Approves from '/imports/lib/collections/approves';

const STATS_FIELDS = ['components', 'obligations', 'completed', 'totalActivity', 'completedActivity'];

/**
 * Copy the key figures of an approval's notice or SBOM file onto the approval
 * (stats.notice / stats.sbom), for the Overview tab and the Notice % column.
 *
 * A trusted server write scoped to the file's company. It does not go through
 * Approves.Update: the files are generated in the background without a user, and
 * that method refused the write, so stats.notice was never set.
 *
 * @param {'notice'|'sbom'} kind
 * @param {Object} doc the notice or SBOM file document
 * @param {String[]} [fieldNames] the fields an update changed; undefined for an insert
 */
export async function writeApprovalStats(kind, doc, fieldNames) {
  if (!doc || typeof doc.approveId !== 'string' || typeof doc.companyId !== 'string') {
    return;
  }
  if (Array.isArray(fieldNames) && !fieldNames.some((field) => STATS_FIELDS.indexOf(field) > -1)) {
    return;
  }
  const stats = {};
  STATS_FIELDS.forEach(function (field) {
    stats[field] = doc[field];
  });
  await Approves.updateAsync({_id: doc.approveId, companyId: doc.companyId},
    {$set: {[`stats.${kind}`]: stats}}, {bypassCollection2: true});
}
