// Pure, dependency-free helpers for the CSAF feed access logic.
// CommonJS so the Jest integration harness can require it without Meteor.
const TLP_LEVELS = ['WHITE', 'GREEN', 'AMBER', 'RED'];

function extractTlp(data) {
  if (!data) {
    return undefined;
  }
  let doc = data;
  if (typeof data === 'string') {
    try {
      doc = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  const label = doc && doc.document && doc.document.distribution &&
    doc.document.distribution.tlp && doc.document.distribution.tlp.label;
  if (!label || typeof label !== 'string') {
    return undefined;
  }
  const upper = label.toUpperCase();
  return TLP_LEVELS.indexOf(upper) > -1 ? upper : undefined;
}

function isTlpAccessible(docTlp, key) {
  if (!docTlp || !key || !Array.isArray(key.tlpLevels) || key.tlpLevels.length === 0) {
    return false;
  }
  return key.tlpLevels.indexOf(docTlp) > -1;
}

// A document is published once an upload to the provider succeeded: that is the
// only place `published` is set (ts-csaf.js), and a later re-publish that fails
// sets status FAILED but keeps it, so the advisory that is already public stays
// in the feed. csaf/remove.js and csaf-list.js treat `published` the same way.
// Drafts and documents whose first upload failed have no `published`.
const PUBLISHED = {$type: 'date'};

// The feed serves published, non-removed documents whose TLP level the key
// permits. Drafts are never served.
function buildFeedQuery(companyId, key) {
  return {
    companyId: companyId,
    removed: {$exists: false},
    published: PUBLISHED,
    tlp: {$in: key.tlpLevels}
  };
}

// One feed document by id, under the same published rule as the list. The TLP
// check against the key is isTlpAccessible().
function buildFeedDocumentQuery(companyId, id) {
  return {
    _id: id,
    companyId: companyId,
    removed: {$exists: false},
    published: PUBLISHED
  };
}

// The provider directory for a document: the lower-case TLP label
// (white / green / amber / red), as the CSAF provider files documents by it.
// A document without a label keeps the previous default, white.
function providerTlpDirectory(data) {
  return (extractTlp(data) || 'WHITE').toLowerCase();
}

module.exports = {TLP_LEVELS, extractTlp, isTlpAccessible, buildFeedQuery, buildFeedDocumentQuery, providerTlpDirectory};
