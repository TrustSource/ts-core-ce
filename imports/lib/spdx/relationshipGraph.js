// Turning an SPDX `relationships` array into a parent -> children map.
//
// A real SPDX document carries a FLAT `packages` list plus a `relationships` graph; nesting
// packages inside one another is not part of the spec. Reading only the nested form meant every
// standard document imported as a single flat level, losing the dependency structure the
// document actually described. This module derives that structure; the caller expands it into
// the scan tree.
//
// Plain CommonJS with no imports so it is unit-testable under Jest.

// Relationship types that mean "the related element sits under this one".
const PARENT_TO_CHILD = ['DEPENDS_ON', 'CONTAINS', 'HAS_PREREQUISITE'];
// ... and the same edges written the other way round.
const CHILD_TO_PARENT = ['DEPENDENCY_OF', 'CONTAINED_BY', 'PREREQUISITE_FOR'];
// What the document itself declares as its subject(s).
const DESCRIBES = ['DESCRIBES'];
const DESCRIBED_BY = ['DESCRIBED_BY'];

function packageId(pkg, index) {
  return (pkg && (pkg.SPDXID || pkg.spdxId)) || ('SPDXRef-Package-' + index);
}

function addEdge(childrenOf, parent, child) {
  if (!parent || !child || parent === child) return;   // a package is not its own dependency
  const list = childrenOf[parent] || (childrenOf[parent] = []);
  if (list.indexOf(child) === -1) list.push(child);
}

/**
 * @param packages      the document's flat `packages` array
 * @param relationships the document's `relationships` array
 * @param documentId    the document's own SPDXID (default 'SPDXRef-DOCUMENT')
 * @returns {{hasGraph, childrenOf, rootIds, byId, orderedIds}}
 *   hasGraph   - false when the document carries no usable dependency edge, so the caller
 *                should keep its previous (nested `packages`) behaviour
 *   rootIds    - what the document describes, plus every package nothing else points at, plus
 *                any package reachable only inside a cycle. Ordered as the document lists them,
 *                so a scan is stable across re-imports.
 */
function buildSpdxGraph(packages, relationships, documentId) {
  const docId = documentId || 'SPDXRef-DOCUMENT';
  const list = Array.isArray(packages) ? packages : [];
  const byId = {};
  const orderedIds = [];
  list.forEach(function (pkg, index) {
    const id = packageId(pkg, index);
    if (byId[id]) return;              // duplicate SPDXID: first wins
    byId[id] = pkg;
    orderedIds.push(id);
  });

  const childrenOf = {};
  const describes = [];
  let sawEdge = false;

  (Array.isArray(relationships) ? relationships : []).forEach(function (rel) {
    if (!rel || typeof rel.relationshipType !== 'string') return;
    const type = rel.relationshipType.toUpperCase();
    const from = rel.spdxElementId;
    const to = rel.relatedSpdxElement;
    if (typeof from !== 'string' || typeof to !== 'string') return;

    if (DESCRIBES.indexOf(type) !== -1) {
      if (from === docId && byId[to] && describes.indexOf(to) === -1) { describes.push(to); sawEdge = true; }
      return;
    }
    if (DESCRIBED_BY.indexOf(type) !== -1) {
      if (to === docId && byId[from] && describes.indexOf(from) === -1) { describes.push(from); sawEdge = true; }
      return;
    }
    // Edges to or from anything that is not a package in this document (a file, an external
    // document reference) carry no component to place, so they are ignored.
    if (!byId[from] || !byId[to]) return;

    if (PARENT_TO_CHILD.indexOf(type) !== -1) { addEdge(childrenOf, from, to); sawEdge = true; }
    else if (CHILD_TO_PARENT.indexOf(type) !== -1) { addEdge(childrenOf, to, from); sawEdge = true; }
  });

  // Anything that is some other package's child cannot also be a top-level entry.
  const isChild = {};
  Object.keys(childrenOf).forEach(function (parent) {
    childrenOf[parent].forEach(function (child) { isChild[child] = true; });
  });

  const rootIds = [];
  function addRoot(id) {
    if (byId[id] && rootIds.indexOf(id) === -1) rootIds.push(id);
  }
  describes.forEach(addRoot);
  // Every package nothing points at. Keeps a package that appears in no relationship at all -
  // dropping it would silently lose a component the document listed.
  orderedIds.forEach(function (id) { if (!isChild[id]) addRoot(id); });
  // A cycle whose members are all children of one another is reachable from no root; seed it
  // from the first member so those components still land in the scan.
  orderedIds.forEach(function (id) {
    if (rootIds.length === 0 || !isReachable(id, rootIds, childrenOf)) addRoot(id);
  });

  return {hasGraph: sawEdge, childrenOf: childrenOf, rootIds: rootIds, byId: byId, orderedIds: orderedIds};
}

// Iterative: a dependency chain is as long as the uploaded document makes it, and one frame
// per link would overflow the stack well inside the body-size limit.
function isReachable(target, rootIds, childrenOf) {
  const stack = rootIds.slice();
  const seen = {};
  while (stack.length) {
    const id = stack.pop();
    if (id === target) return true;
    if (seen[id]) continue;
    seen[id] = true;
    (childrenOf[id] || []).forEach(function (child) { if (!seen[child]) stack.push(child); });
  }
  return false;
}

module.exports = {buildSpdxGraph, packageId};
