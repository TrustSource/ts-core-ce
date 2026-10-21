// CSAF fields that only the server flows write, and that CSAF.Update therefore
// strips from a client-supplied modifier (via sanitizeModifier's protectedFields).
//
//   * status / published* - set by the upload in ts-csaf.js. The public feed
//     serves documents with `published` set (lib/csaf/feedAccess.js), so an
//     editor writing it would publish a draft without an upload.
//   * failed / failedReason - set by a failed upload in ts-csaf.js.
//   * removed* - the feed hides documents with `removed`; unsetting it would
//     bring a withdrawn advisory back.
//   * submitted / providerId - set once by csaf/create.js. ts-csaf.js counts
//     advisory numbers per providerId, so it must stay the tenant's own.
//   * tlp - derived from `data` (create.js, update.js, ts-csaf.js). The feed
//     filters keys by it, so it must match the label in the document.
//   * updated / updatedBy / updatedByName - stamped by update.js itself.
//
// `data`, `name` and `category` stay editable: `data` is the working copy the
// CSAF editors save.
//
// CommonJS with no imports, so Jest can require it directly - the same
// dual-consumption pattern as riskProperties/managedFields.js.

const CSAF_MANAGED_FIELDS = [
  'status',
  'submitted',
  'published',
  'publishedFileName',
  'publishedBy',
  'publishedByName',
  'failed',
  'failedReason',
  'removed',
  'removedReason',
  'removedBy',
  'removedByName',
  'providerId',
  'tlp',
  'updated',
  'updatedBy',
  'updatedByName'
];

module.exports = {CSAF_MANAGED_FIELDS};
