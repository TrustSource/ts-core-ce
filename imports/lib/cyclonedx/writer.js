const {PackageURL} = require('packageurl-js');
const {v4: uuidv4} = require('uuid');
const _ = require('underscore');
const E = require('./enums');
const {version: APP_VERSION} = require('../../../package.json');

// The application that writes the BOM, listed under metadata.tools.
const APP_TOOL = {type: 'application', name: 'TrustSource CE', version: APP_VERSION};

const PROP_KEYS_BY_ASSET = {
  algorithm: {field: 'algorithmProperties', keys: E.ALGORITHM_PROP_KEYS},
  certificate: {field: 'certificateProperties', keys: E.CERTIFICATE_PROP_KEYS},
  protocol: {field: 'protocolProperties', keys: E.PROTOCOL_PROP_KEYS},
  'related-crypto-material': {
    field: 'relatedCryptoMaterialProperties', keys: E.RELATED_MATERIAL_PROP_KEYS
  }
};

// Enum membership guards so we never emit an out-of-spec enum value.
const ENUM_GUARD = {
  mode: E.MODE,
  padding: E.PADDING,
  primitive: E.PRIMITIVE,
  executionEnvironment: E.EXECUTION_ENVIRONMENT,
  implementationPlatform: E.IMPLEMENTATION_PLATFORM
};

function isEmpty(v) {
  return v === undefined || v === null || v === '' ||
    (Array.isArray(v) && v.length === 0);
}

// certificateState items are objects in the spec; accept either an existing object
// or a known-enum state string, dropping anything invalid.
function toCertificateState(s) {
  if (s && typeof s === 'object') return s;
  return E.CERTIFICATE_STATE.indexOf(s) !== -1 ? {state: s} : null;
}

// cipherSuites items are cipherSuite objects ({name, ...}) in the spec; accept an
// existing object or wrap a non-empty suite name string, dropping anything invalid.
function toCipherSuite(s) {
  if (s && typeof s === 'object') return s;
  return (typeof s === 'string' && s) ? {name: s} : null;
}

// Build a cleaned property object: keep only allowed keys, coerce ints/arrays,
// drop empties and out-of-enum scalar values.
function cleanProps(source, keys) {
  const out = {};
  if (!source) return out;
  keys.forEach((key) => {
    let value = source[key];
    if (E.ARRAY_PROP_KEYS.indexOf(key) !== -1 && value !== undefined && !Array.isArray(value)) {
      value = isEmpty(value) ? [] : [value];
    }
    if (E.INTEGER_PROP_KEYS.indexOf(key) !== -1 && !isEmpty(value)) {
      const n = parseInt(value, 10);
      value = Number.isNaN(n) ? undefined : n;
    }
    if (ENUM_GUARD[key] && !isEmpty(value) && ENUM_GUARD[key].indexOf(value) === -1) {
      value = undefined; // drop invalid enum (e.g. legacy CPU-platform in `mode`)
    }
    // certificateState items are objects ({state}) in the spec, not bare strings.
    if (key === 'certificateState' && Array.isArray(value)) {
      value = value.map(toCertificateState).filter((s) => !!s);
      if (!value.length) value = undefined;
    }
    // cipherSuites items are cipherSuite objects ({name}) in the spec, not bare strings.
    if (key === 'cipherSuites' && Array.isArray(value)) {
      value = value.map(toCipherSuite).filter((s) => !!s);
      if (!value.length) value = undefined;
    }
    if (!isEmpty(value)) out[key] = value;
  });
  return out;
}

// Map a stored CryptoProperties doc -> a cryptographic-asset component.
function mapCryptoAsset(entry) {
  const assetType = E.ASSET_TYPES.indexOf(entry.assetType) !== -1
    ? entry.assetType : 'algorithm';
  const spec = PROP_KEYS_BY_ASSET[assetType];
  const props = cleanProps(entry[spec.field], spec.keys);
  const cryptoProperties = {assetType};
  if (Object.keys(props).length) cryptoProperties[spec.field] = props;
  return {
    type: 'cryptographic-asset',
    name: entry.name,
    'bom-ref': entry['bom-ref'] || entry.name,
    cryptoProperties
  };
}

// Map a stored AiProperties doc (or an ai_models marker) -> a machine-learning-model
// component. Imported artifacts carry the full original component (`raw`) and are
// round-tripped losslessly (author, description, licenses, externalReferences, properties,
// datasets, considerations…), overlaying any edited identity fields. Manually-added
// artifacts have no `raw`, so a minimal modelCard is synthesized from the structured fields.
function mapMlAsset(entry) {
  if (entry.raw && typeof entry.raw === 'object') {
    const comp = Object.assign({}, entry.raw);
    comp.type = E.ML_ASSET_TYPE;
    if (entry.name) comp.name = entry.name;
    if (entry.version) comp.version = entry.version;
    if (entry.purl) comp.purl = entry.purl;
    if (entry.provider) comp.publisher = entry.provider;
    if (entry.modelCard && typeof entry.modelCard === 'object') comp.modelCard = entry.modelCard;
    comp['bom-ref'] = entry['bom-ref'] || comp['bom-ref'] || entry.purl || entry.name;
    return comp;
  }
  const comp = {
    type: E.ML_ASSET_TYPE,
    name: entry.name,
    'bom-ref': entry['bom-ref'] || entry.purl || entry.name
  };
  if (entry.version) comp.version = entry.version;
  if (entry.purl) comp.purl = entry.purl;
  if (entry.provider) comp.publisher = entry.provider;
  const mp = {};
  if (entry.task) mp.task = entry.task;
  if (entry.modelFamily) mp.architectureFamily = entry.modelFamily;
  if (entry.architecture) mp.modelArchitecture = entry.architecture;
  if (Object.keys(mp).length) comp.modelCard = {modelParameters: mp};
  return comp;
}

function getPackageUrl(componentKey, version) {
  // Mirrors reportConverter: only emit a purl for non-internal manager keys.
  if (!componentKey || typeof componentKey.split !== 'function') return null;
  const parts = componentKey.split(':');
  if (parts.length < 2 || parts[0] === 'im') return null;
  const manager = parts[0];
  const compParts = parts.slice(1);
  const org = compParts.length > 1 ? compParts[0] : null;
  const name = compParts.length > 1 ? compParts[1] : compParts[0];
  if (!name) return null;
  try {
    return new PackageURL(manager, org, name, version).toString();
  } catch (_e) { // eslint-disable-line sonarjs/no-ignored-exceptions
    return null;
  }
}

function dependencyToComponent(dependency) {
  const {name, key, description, homepageUrl, repoUrl, licenses, versions, version} = dependency;
  const versionData = (versions && versions[0]) || version;
  const purl = getPackageUrl(key, version);
  const comp = {
    type: 'library',
    'bom-ref': purl,
    name,
    version: versionData || '0.0.0',
    description,
    purl,
    externalReferences: []
  };
  if (licenses && licenses[0] && licenses[0].name) {
    comp.licenses = [{license: {id: licenses[0].name}}];
  }
  if (repoUrl) comp.externalReferences.push({type: 'vcs', url: repoUrl});
  if (homepageUrl) comp.externalReferences.push({type: 'website', url: homepageUrl});
  if (!comp.externalReferences.length) delete comp.externalReferences;
  if (!comp.description) delete comp.description;
  return comp;
}

function findCryptoDetail(cryptoProperties, dependency, algorithmName) {
  function matches(item) {
    return item && item.name && algorithmName &&
      item.name.toLowerCase() === algorithmName.toLowerCase();
  }
  let details = (cryptoProperties && cryptoProperties[dependency.moduleId] || []).filter(matches);
  const projectDetails = (cryptoProperties && cryptoProperties.project || []).filter(matches);
  details = details.concat(projectDetails);
  if (details.length > 1) {
    const byModule = details.find((d) => d.moduleId);
    const byProject = details.find((d) => d.projectId);
    if (byModule) details = [byModule];
    else if (byProject) details = [byProject];
  }
  return details[0];
}

// Locate the managed AI artifact detail (with full modelCard) for an ai_models marker,
// preferring a module-level entry over a project-level one. Mirrors findCryptoDetail.
function findAiDetail(aiProperties, dependency, modelName) {
  function matches(item) {
    return item && item.name && modelName &&
      item.name.toLowerCase() === modelName.toLowerCase();
  }
  let details = (aiProperties && aiProperties[dependency.moduleId] || []).filter(matches);
  const projectDetails = (aiProperties && aiProperties.project || []).filter(matches);
  details = details.concat(projectDetails);
  if (details.length > 1) {
    const byModule = details.find((d) => d.moduleId);
    const byProject = details.find((d) => d.projectId);
    if (byModule) details = [byModule];
    else if (byProject) details = [byProject];
  }
  return details[0];
}

// Recursive walk (ported from reportConverter handleDependency, cydx branch only).
function walk(ctx, dependency, parent) {
  const component = dependencyToComponent(dependency);
  const sbomEmit = !ctx.variant || ctx.variant === 'SBOM';
  const cbomEmit = !ctx.variant || ctx.variant === 'CBOM';
  const aibomEmit = !ctx.variant || ctx.variant === 'AIBOM';

  if (sbomEmit && component['bom-ref'] &&
      !ctx.components.find((i) => i['bom-ref'] === component['bom-ref'])) {
    ctx.components.push(component);
  }
  if (sbomEmit && parent && component['bom-ref']) {
    const exists = ctx.dependencies.find((i) =>
      i.ref === parent['bom-ref'] && i.dependsOn[0] === component['bom-ref']);
    if (!exists) {
      ctx.dependencies.push({ref: parent['bom-ref'], dependsOn: [component['bom-ref']]});
    }
  }

  if (cbomEmit && Array.isArray(dependency.crypto_algorithms)) {
    dependency.crypto_algorithms.forEach((algorithm) => {
      const detail = findCryptoDetail(ctx.cryptoProperties, dependency, algorithm.algorithm);
      const cryptoComp = mapCryptoAsset(detail || {name: algorithm.algorithm});
      const cryptoRef = cryptoComp['bom-ref'];
      const present = _.some(ctx.components, (c) =>
        c['bom-ref'] === cryptoRef || (c.name && algorithm.algorithm &&
          c.name.toLowerCase() === algorithm.algorithm.toLowerCase()));
      if (!present) ctx.components.push(cryptoComp);
      // Record the component -> crypto-asset link in the dependency graph so it
      // survives export. Only meaningful when the owning component is also emitted
      // (the combined/"All" variant); pure CBOM has no software components to link.
      if (sbomEmit && component['bom-ref'] && cryptoRef) {
        const exists = ctx.dependencies.find((i) =>
          i.ref === component['bom-ref'] && i.dependsOn.indexOf(cryptoRef) !== -1);
        if (!exists) {
          ctx.dependencies.push({ref: component['bom-ref'], dependsOn: [cryptoRef]});
        }
      }
    });
  }

  if (aibomEmit && Array.isArray(dependency.ai_models)) {
    dependency.ai_models.forEach((model) => {
      const detail = findAiDetail(ctx.aiProperties, dependency, model.name);
      const mlComp = mapMlAsset(detail || model);
      const mlRef = mlComp['bom-ref'];
      const present = _.some(ctx.components, (c) =>
        c['bom-ref'] === mlRef || (c.name && model.name &&
          c.name.toLowerCase() === model.name.toLowerCase()));
      if (!present) ctx.components.push(mlComp);
      // Record the component -> ml-model link in the dependency graph (only meaningful
      // when the owning software component is also emitted - the combined "All" variant).
      if (sbomEmit && component['bom-ref'] && mlRef) {
        const exists = ctx.dependencies.find((i) =>
          i.ref === component['bom-ref'] && i.dependsOn.indexOf(mlRef) !== -1);
        if (!exists) {
          ctx.dependencies.push({ref: component['bom-ref'], dependsOn: [mlRef]});
        }
      }
    });
  }

  if (Array.isArray(dependency.dependencies)) {
    dependency.dependencies.forEach((child) => walk(ctx, child, component));
  }
}

function buildMetadata(company) {
  const metadata = {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        {type: 'application', name: 'CycloneDX Node.js module', version: '3.6.0'},
        APP_TOOL
      ]
    }
  };
  if (company) {
    metadata.supplier = {
      name: company.name,
      url: company.distribution && company.distribution.email
        ? [company.distribution.email] : []
    };
  }
  return metadata;
}

// Emit managed crypto assets (recorded in module/project settings) that aren't linked
// to any component via the dependency graph. Without this a CBOM exported from a module
// with managed-but-undetected assets would be empty. Deduped against already-emitted
// components by bom-ref and name. cryptoProperties is keyed by moduleId (+ 'project'),
// each value being an array of stored CryptoProperties docs.
function emitManagedCryptoAssets(ctx) {
  const props = ctx.cryptoProperties;
  if (!props || typeof props !== 'object') return;
  Object.keys(props).forEach((key) => {
    const list = props[key];
    if (!Array.isArray(list)) return;
    list.forEach((entry) => {
      if (!entry || !entry.name) return;
      const cryptoComp = mapCryptoAsset(entry);
      const ref = cryptoComp['bom-ref'];
      const present = _.some(ctx.components, (c) =>
        c['bom-ref'] === ref || (c.name && entry.name &&
          c.name.toLowerCase() === entry.name.toLowerCase()));
      if (!present) ctx.components.push(cryptoComp);
    });
  });
}

// Emit managed AI artifacts (recorded in module/project settings) that aren't linked to
// any component via the dependency graph - mirrors emitManagedCryptoAssets. Without this
// an AIBOM exported from a module with managed-but-undetected models would be empty.
// aiProperties is keyed by moduleId (+ 'project'), each value an array of AiProperties docs.
function emitManagedAiAssets(ctx) {
  const props = ctx.aiProperties;
  if (!props || typeof props !== 'object') return;
  Object.keys(props).forEach((key) => {
    const list = props[key];
    if (!Array.isArray(list)) return;
    list.forEach((entry) => {
      if (!entry || !entry.name) return;
      const mlComp = mapMlAsset(entry);
      const ref = mlComp['bom-ref'];
      const present = _.some(ctx.components, (c) =>
        c['bom-ref'] === ref || (c.name && entry.name &&
          c.name.toLowerCase() === entry.name.toLowerCase()));
      if (!present) ctx.components.push(mlComp);
    });
  });
}

// variant: undefined (All) | 'SBOM' | 'CBOM' | 'AIBOM'
function buildDocument(report, variant) {
  const ctx = {
    components: [],
    dependencies: [],
    variant,
    cryptoProperties: report.cryptoProperties,
    aiProperties: report.aiProperties
  };
  if (report.tree && Array.isArray(report.tree.dependencies)) {
    report.tree.dependencies.forEach((child) => walk(ctx, child, null));
  }
  // CBOM (and the combined "All" variant) must include managed crypto assets even when
  // no component references them; SBOM stays software-only.
  if (!variant || variant === 'CBOM') {
    emitManagedCryptoAssets(ctx);
  }
  // AIBOM (and the combined "All" variant) likewise includes managed AI artifacts.
  if (!variant || variant === 'AIBOM') {
    emitManagedAiAssets(ctx);
  }
  const doc = {
    bomFormat: 'CycloneDX',
    specVersion: E.SPEC_VERSION,
    serialNumber: 'urn:uuid:' + uuidv4(),
    version: 1,
    metadata: buildMetadata(report.company),
    components: ctx.components
  };
  if (ctx.dependencies.length) doc.dependencies = ctx.dependencies;
  return doc;
}

function merge(sboms) {
  const compMap = {};
  const relMap = {};
  (sboms || []).forEach((sbom) => {
    if (Array.isArray(sbom.components)) {
      sbom.components.forEach((c) => {
        const key = c.purl || (c.name && c.version ? c.name + '@' + c.version : null);
        if (!key || compMap[key]) return;
        compMap[key] = {
          'bom-ref': c['bom-ref'] || key,
          type: c.type || 'library',
          name: c.name || null,
          version: c.version || null,
          purl: c.purl || null
        };
      });
    }
    if (Array.isArray(sbom.dependencies)) {
      sbom.dependencies.forEach((dep) => {
        if (!dep.ref || !Array.isArray(dep.dependsOn)) return;
        dep.dependsOn.forEach((to) => {
          if (to) relMap[dep.ref + '>' + to] = {from: dep.ref, to};
        });
      });
    }
  });

  const depMap = {};
  Object.keys(relMap).forEach((k) => {
    const rel = relMap[k];
    if (!depMap[rel.from]) depMap[rel.from] = {ref: rel.from, dependsOn: []};
    depMap[rel.from].dependsOn.push(rel.to);
  });

  const doc = {
    bomFormat: 'CycloneDX',
    specVersion: E.SPEC_VERSION,
    serialNumber: 'urn:uuid:' + uuidv4(),
    version: 1,
    metadata: buildMetadata(null),
    components: Object.keys(compMap).map((k) => compMap[k])
  };
  const deps = Object.keys(depMap).map((k) => depMap[k]);
  if (deps.length) doc.dependencies = deps;
  return doc;
}

// getPackageUrl is exported for REUSE, not because this module owns purls: any
// caller needing the same componentKey+version -> purl rendering the SBOM emits
// should use it rather than add a fourth near-duplicate builder.
module.exports = {
  buildDocument, merge, mapCryptoAsset, mapMlAsset, dependencyToComponent, cleanProps, getPackageUrl
};
