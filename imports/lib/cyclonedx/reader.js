const {purlToKey} = require('../component/keyFromPurl');
const E = require('./enums');

function pickChecksum(hashes) {
  if (!Array.isArray(hashes) || !hashes.length) return undefined;
  const priority = ['SHA-512', 'SHA-384', 'SHA-256', 'SHA-1', 'MD5'];
  const pick = priority.map((a) => hashes.find((h) => h && h.alg === a))
    .find((h) => h && h.content) || hashes.find((h) => h && h.content);
  return pick && pick.content ? pick.content : undefined;
}

function findRef(externalReferences, type) {
  const ref = Array.isArray(externalReferences) &&
    externalReferences.find((r) => r && r.type === type);
  return ref && ref.url;
}

function supplierName(supplier) {
  if (!supplier) return undefined;
  return typeof supplier === 'string' ? supplier : supplier.name;
}

// Raw license objects ({key,name,url}); preProcessLicenses applied later by the caller.
function rawLicenses(licenses) {
  if (!Array.isArray(licenses)) return [];
  return licenses.map((item) => {
    if (item && item.license) {
      return {
        key: item.license.id,
        name: item.license.id || item.license.name || item.license.expression,
        url: item.license.url
      };
    }
    if (item && item.expression) return {name: item.expression};
    return null;
  }).filter((x) => !!x);
}

const KNOWN_VERSIONS = E.SUPPORTED_IMPORT_VERSIONS; // 1.2..1.7

// How deep a scan dependency tree may nest, for any importer. A BOM is untrusted input, and
// MongoDB rejects a document nested past ~89 dependency levels, so a deeper tree cannot be
// stored at all. Whatever falls below the cap continues as a scan root, so the components
// survive - only their position in the tree moves.
const MAX_DEPENDENCY_NESTING = 40;

function isRecognizedComponent(component, effectiveVersion) {
  const t = component.type;
  // Any spec component type except cryptographic-asset (round-tripped separately).
  const typeOk = E.COMPONENT_TYPES.indexOf(t) !== -1 && t !== 'cryptographic-asset';
  const versionOk = !effectiveVersion || KNOWN_VERSIONS.indexOf(effectiveVersion) !== -1;
  return typeOk && versionOk;
}

function componentToDependency(component, pkgType, effectiveVersion, childDeps) {
  const {type, name, version, description, licenses, purl, externalReferences,
    publisher, hashes, group, copyright, cpe, author, supplier} = component;
  const bomRef = component['bom-ref'];
  const checksum = pickChecksum(hashes);

  const cryptoAlgorithms = Array.isArray(component.crypto_algorithms) &&
    component.crypto_algorithms.length ? component.crypto_algorithms : undefined;
  const aiModels = Array.isArray(component.ai_models) &&
    component.ai_models.length ? component.ai_models : undefined;

  if (!isRecognizedComponent(component, effectiveVersion)) {
    const priv = {
      key: purlToKey(purl, (pkgType || type), name, bomRef),
      name: '' + name,
      versions: [version],
      private: true,
      dependencies: childDeps || []
    };
    if (cryptoAlgorithms) priv.crypto_algorithms = cryptoAlgorithms;
    if (aiModels) priv.ai_models = aiModels;
    return priv;
  }

  const dependency = {
    name,
    description,
    versions: version ? [version] : null,
    homepageUrl: findRef(externalReferences, 'website'),
    repoUrl: findRef(externalReferences, 'vcs'),
    mailingUrl: findRef(externalReferences, 'mailing-list'),
    issuesUrl: findRef(externalReferences, 'issue-tracker'),
    distributionUrl: findRef(externalReferences, 'distribution'),
    documentationUrl: findRef(externalReferences, 'documentation'),
    provider: publisher,
    group,
    copyright,
    cpe,
    author,
    supplier: supplierName(supplier),
    checksum,
    licenses: rawLicenses(licenses),
    dependencies: childDeps || []
  };
  dependency.key = purlToKey(purl, (pkgType || type), name, bomRef);
  if (cryptoAlgorithms) dependency.crypto_algorithms = cryptoAlgorithms;
  if (aiModels) dependency.ai_models = aiModels;
  return dependency;
}

function buildDependencyTree(list, dependencies, pkgType, effectiveVersion, cryptoByRef, mlByRef) {
  const cryptoRefs = cryptoByRef || {};
  const mlRefs = mlByRef || {};
  const isAsset = (ref) => !!cryptoRefs[ref] || !!mlRefs[ref];
  if (!dependencies || !dependencies.length) {
    // No graph -> no component<->asset linkage (only graph-linked assets attach).
    return list.map((c) => componentToDependency(c, pkgType, effectiveVersion, []));
  }
  const raw = {};   // bom-ref -> raw software component (assets are excluded from `list`)
  list.forEach((c) => { raw[c['bom-ref']] = c; });
  const childrenOf = {};
  dependencies.forEach((dep) => {
    if (Array.isArray(dep.dependsOn)) childrenOf[dep.ref] = dep.dependsOn;
  });

  // cryptographic-asset / machine-learning-model components are contracted OUT of the
  // dependency graph (round-tripped into the crypto/ai payloads instead). To avoid
  // orphaning the SOFTWARE they depend on - common in AIBOMs, where the model is the graph
  // root with its frameworks (PyTorch, ONNX, ...) beneath it - an asset is spliced out:
  // its software children are pulled up to the asset's software parent, and the asset is
  // recorded as a crypto_algorithms / ai_models marker on that parent. An asset that has no
  // software parent (e.g. the root model) leaves its software children as scan roots.

  // Software children reachable from `ref`, contracting any asset nodes in between. Each
  // asset encountered is reported via `onAsset` so the owning software node gets a marker.
  // Iterative (depth-first, same order as the plain recursion): the asset chain comes straight
  // from an uploaded BOM, and one frame per link would overflow the call stack on a long one.
  function resolveChildren(ref, onAsset) {
    const out = [];
    const seen = {};
    const stack = [{list: childrenOf[ref] || [], i: 0}];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.i >= frame.list.length) {
        stack.pop();
        continue;
      }
      const childRef = frame.list[frame.i++];
      if (isAsset(childRef)) {
        if (onAsset) onAsset(childRef);
        if (!seen[childRef]) {
          seen[childRef] = true;
          stack.push({list: childrenOf[childRef] || [], i: 0});
        }
      } else if (raw[childRef]) {
        out.push(childRef);
      }
    }
    return out;
  }

  // The BOM dependency graph is a DAG (often a cyclic one - libc6 <-> libgcc-s1 in any distro
  // SBOM), but everything downstream walks the result as a TREE: license preprocessing,
  // processScan's handleDependency, JSON.stringify of the scan document. Handing the same node
  // object to several parents therefore costs one walk per PATH that reaches it (billions of
  // visits on a 600-component distro SBOM) and a cycle never terminates at all. So each
  // occurrence gets its own node and only the FIRST occurrence of a component carries its
  // children; later ones are leaves that still record the dependsOn edge. Tree size stays
  // bounded by the number of edges in the graph.
  const MAX_NESTING = MAX_DEPENDENCY_NESTING;
  const expanded = {};    // bom-ref -> this component already carries its children in the tree
  const overflow = [];    // refs cut off by the nesting cap, re-attached as roots below

  // A node for one occurrence of `ref`, plus the refs of its software children.
  function newNode(ref) {
    const node = componentToDependency(raw[ref], pkgType, effectiveVersion, []);
    const addMarker = (assetRef) => {
      const cryptoComp = cryptoRefs[assetRef];
      if (cryptoComp) {
        if (!node.crypto_algorithms) node.crypto_algorithms = [];
        node.crypto_algorithms.push({algorithm: cryptoComp.name});
        return;
      }
      const mlComp = mlRefs[assetRef];
      if (mlComp) {
        if (!node.ai_models) node.ai_models = [];
        node.ai_models.push(mlMarker(mlComp));
      }
    };
    // Resolved for repeat occurrences too: a contracted crypto/ai asset describes the
    // component itself, not one position in the tree.
    return {node, children: resolveChildren(ref, addMarker)};
  }

  // Expands `rootRef` into a tree, iteratively - a dependency chain is as long as the uploader
  // wants it to be, and recursion per level overflows the call stack well inside the 5 MB body
  // limit. Only the FIRST occurrence of a component carries its children; later ones stay
  // leaves that still record the dependsOn edge. That keeps the result acyclic and bounded by
  // the number of edges in the graph, which matters because everything downstream walks it as
  // a TREE (license preprocessing, processScan's handleDependency, JSON.stringify of the scan
  // document): one shared node object costs a walk per PATH reaching it - 3.2e9 visits on a
  // 600-component distro SBOM - and a cycle never terminates at all.
  function expandRoot(rootRef) {
    const root = newNode(rootRef);
    expanded[rootRef] = true;
    const work = [{ref: rootRef, node: root.node, children: root.children, depth: 1}];
    while (work.length) {
      const item = work.pop();
      item.children.forEach((childRef) => {
        if (childRef === item.ref) return;         // a component is not its own dependency
        const child = newNode(childRef);
        item.node.dependencies.push(child.node);
        if (expanded[childRef]) return;            // expanded elsewhere -> stays a leaf here
        if (item.depth + 1 >= MAX_NESTING) {
          overflow.push(childRef);
          return;
        }
        expanded[childRef] = true;
        work.push({ref: childRef, node: child.node, children: child.children,
          depth: item.depth + 1});
      });
    }
    return root.node;
  }

  // A software component is a root unless it is an (effective) software child of another
  // software component - resolved through contracted asset nodes, so a library whose only
  // parent is a split-out model is promoted to a root rather than dropped.
  const isSoftwareChild = {};
  Object.keys(raw).forEach((ref) => {
    resolveChildren(ref).forEach((childRef) => { isSoftwareChild[childRef] = true; });
  });

  const seenRoot = {};
  const tree = [];
  const consider = (ref) => {
    if (!raw[ref] || isSoftwareChild[ref] || seenRoot[ref]) return;
    seenRoot[ref] = true;
    tree.push(expandRoot(ref));
  };
  dependencies.forEach((dep) => {
    consider(dep.ref);
    if (Array.isArray(dep.dependsOn)) dep.dependsOn.forEach(consider);
  });

  // Every member of a cycle is a software child of another member, so a cycle that no acyclic
  // component points into yields no root at all and its components would vanish from the scan.
  // Promote whatever the pass above never reached - a no-op for acyclic graphs, where each
  // component is either a root or reachable from one.
  dependencies.forEach((dep) => {
    [dep.ref].concat(Array.isArray(dep.dependsOn) ? dep.dependsOn : []).forEach((ref) => {
      if (!raw[ref] || expanded[ref]) return;
      tree.push(expandRoot(ref));
    });
  });

  // Subtrees cut off by MAX_NESTING continue as roots. Index loop: expanding one of them can
  // append further overflow refs.
  for (let i = 0; i < overflow.length; i++) {
    const ref = overflow[i];
    if (!raw[ref] || expanded[ref]) continue;
    tree.push(expandRoot(ref));
  }
  return tree;
}

function cryptoAssetToPayload(component) {
  const cp = component.cryptoProperties || {};
  const assetType = E.ASSET_TYPES.indexOf(cp.assetType) !== -1 ? cp.assetType : 'algorithm';
  const payload = {name: component.name, assetType};
  ['algorithmProperties', 'certificateProperties', 'protocolProperties',
    'relatedCryptoMaterialProperties'].forEach((field) => {
    if (cp[field] && typeof cp[field] === 'object') payload[field] = cp[field];
  });
  return payload;
}

// Read a named property from a CycloneDX `properties` block, accepting either the spec
// array form ([{name,value}]) or the object form ({name: value}) seen in some BOMs.
function propValue(properties, key) {
  if (!properties) return undefined;
  if (Array.isArray(properties)) {
    const p = properties.find((x) => x && x.name === key);
    return p && p.value;
  }
  if (typeof properties === 'object') return properties[key];
  return undefined;
}

// Light marker attached to a component that depends on a machine-learning-model. Mirrors
// the {algorithm} marker pushed for crypto assets; the full data lives in the managed AI
// payload (aiProperties), looked up by name on export.
function mlMarker(component) {
  const mc = component.modelCard || {};
  const mp = mc.modelParameters || {};
  const marker = {name: component.name};
  if (component.type) marker.type = component.type;
  if (component.version) marker.version = component.version;
  if (component.purl) marker.purl = component.purl;
  // provider may be carried as publisher, author, or supplier (spec varies across BOMs).
  const provider = component.publisher || component.author ||
    (component.supplier && (typeof component.supplier === 'string'
      ? component.supplier : component.supplier.name));
  if (provider) marker.provider = provider;
  // task may be `modelParameters.task`, the array form `modelParameters.tasks[0].task`, or
  // a `category` property.
  const task = mp.task ||
    (Array.isArray(mp.tasks) && mp.tasks[0] && mp.tasks[0].task) ||
    propValue(component.properties, 'category');
  if (task) marker.task = task;
  return marker;
}

// Map a machine-learning-model component -> a managed AI artifact payload: the marker fields,
// the additional structured fields surfaced in the UI (model family / architecture), the raw
// modelCard, and the FULL original component (`raw`) so export round-trips losslessly
// (author, description, licenses, externalReferences, properties, datasets, considerations…).
function mlComponentToPayload(component) {
  const payload = mlMarker(component);
  const mp = (component.modelCard && component.modelCard.modelParameters) || {};
  if (mp.architectureFamily) payload.modelFamily = mp.architectureFamily;
  if (mp.modelArchitecture) payload.architecture = mp.modelArchitecture;
  if (component.modelCard && typeof component.modelCard === 'object') {
    payload.modelCard = component.modelCard;
  }
  payload.raw = component;
  return payload;
}

// Returns {scan, crypto, ai}. scan.dependencies have RAW licenses; caller applies
// preProcessLicenses. crypto holds parsed cryptographic-asset payloads; ai holds parsed
// machine-learning-model payloads (with raw modelCard passthrough).
function parseBom(body, params) {
  const query = (params && params.query) || {};
  const {components = [], metadata, dependencies} = body || {};
  const effectiveVersion = body && body.specVersion ? body.specVersion : query.version;
  const list = components.slice();
  if (metadata && metadata.component) list.unshift(metadata.component);

  // cryptographic-asset and machine-learning-model components are round-tripped into
  // cryptoProperties / aiProperties, not the dependency graph; they instead attach to the
  // components they are graph-linked to (as crypto_algorithms / ai_models markers).
  const isCrypto = (c) => c && c.type === 'cryptographic-asset';
  const isMl = (c) => c && c.type === E.ML_ASSET_TYPE;
  const cryptoComponents = list.filter(isCrypto);
  const mlComponents = list.filter(isMl);
  const depComponents = list.filter((c) => !isCrypto(c) && !isMl(c));
  const cryptoByRef = {};
  cryptoComponents.forEach((c) => {
    if (c['bom-ref']) cryptoByRef[c['bom-ref']] = c;
  });
  const mlByRef = {};
  mlComponents.forEach((c) => {
    if (c['bom-ref']) mlByRef[c['bom-ref']] = c;
  });

  const scan = {
    project: query.project,
    module: query.module,
    branch: query.branch,
    tag: query.tag,
    binaryLinks: query.binaryLinks,
    demo: query.demo === true || query.demo === 'true' || undefined
  };
  scan.dependencies = buildDependencyTree(depComponents, dependencies, query.pkgType,
    effectiveVersion, cryptoByRef, mlByRef);
  const root = scan.dependencies[0];
  if (root) {
    if (!scan.module) scan.module = root.name;
    if (root.purl || root.name) {
      scan.moduleIdentifierSource = purlToKey(root.purl, query.pkgType, root.name) || root.name;
    }
  }
  // A model is frequently listed twice - as metadata.component AND in components[] - so
  // dedupe, preferring the richer copy (the one carrying a modelCard / asset properties).
  const crypto = dedupePayloads(cryptoComponents.map(cryptoAssetToPayload),
    (p) => (p.name || '') + ':' + (p.assetType || ''),
    (p) => ['algorithmProperties', 'certificateProperties', 'protocolProperties',
      'relatedCryptoMaterialProperties'].some((f) => p[f]));
  const ai = dedupePayloads(mlComponents.map(mlComponentToPayload),
    (p) => p.purl || (p.name || '') + '@' + (p.version || ''),
    (p) => !!p.modelCard);
  return {scan, crypto, ai};
}

// Dedupe payloads by `keyFn`; when keys collide keep the first "rich" entry (per `richFn`),
// otherwise the first seen. Preserves first-seen order.
function dedupePayloads(payloads, keyFn, richFn) {
  const byKey = {};
  const order = [];
  payloads.forEach((p) => {
    const key = keyFn(p);
    if (!(key in byKey)) {
      byKey[key] = p;
      order.push(key);
    } else if (!richFn(byKey[key]) && richFn(p)) {
      byKey[key] = p;   // upgrade to the richer duplicate
    }
  });
  return order.map((k) => byKey[k]);
}

module.exports = {
  MAX_DEPENDENCY_NESTING,
  parseBom,
  componentToDependency,
  buildDependencyTree,
  cryptoAssetToPayload,
  mlComponentToPayload,
  rawLicenses,
  pickChecksum
};
