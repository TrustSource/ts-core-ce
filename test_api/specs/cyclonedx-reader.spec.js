/* eslint-disable no-undef */
const reader = require('../../imports/lib/cyclonedx/reader');

function bom(specVersion, components, dependencies) {
  return {bomFormat: 'CycloneDX', specVersion, components, dependencies};
}

describe('cyclonedx/reader.parseBom - component mapping', () => {
  const components = [
    {
      'bom-ref': 'pkg:npm/app@1.0.0', type: 'application', name: 'app', version: '1.0.0',
      purl: 'pkg:npm/app@1.0.0', description: 'root', group: 'acme', publisher: 'Acme',
      copyright: 'Acme 2026', cpe: 'cpe:2.3:a:acme:app:1.0.0:*:*:*:*:*:*:*',
      author: 'Jane', supplier: {name: 'Acme Inc'},
      licenses: [{license: {id: 'MIT'}}],
      externalReferences: [
        {type: 'website', url: 'https://acme.test'},
        {type: 'vcs', url: 'https://git.acme.test'},
        {type: 'distribution', url: 'https://dl.acme.test'}
      ],
      hashes: [{alg: 'SHA-256', content: 'a'.repeat(64)}]
    },
    {
      'bom-ref': 'pkg:npm/left-pad@1.3.0', type: 'library', name: 'left-pad',
      version: '1.3.0', purl: 'pkg:npm/left-pad@1.3.0'
    }
  ];
  const deps = [{ref: 'pkg:npm/app@1.0.0', dependsOn: ['pkg:npm/left-pad@1.3.0']}];

  it('maps a 1.7 BOM (previously fell through to private)', () => {
    const {scan} = reader.parseBom(bom('1.7', components, deps), {query: {}});
    const root = scan.dependencies[0];
    expect(root.name).toBe('app');
    expect(root.private).toBeUndefined();        // recognized, not private
    expect(root.key).toBe('npm:app');
    expect(root.dependencies[0].name).toBe('left-pad');
  });

  it('extracts enriched fields', () => {
    const {scan} = reader.parseBom(bom('1.7', components, deps), {query: {}});
    const root = scan.dependencies[0];
    expect(root.copyright).toBe('Acme 2026');
    expect(root.group).toBe('acme');
    expect(root.cpe).toBe('cpe:2.3:a:acme:app:1.0.0:*:*:*:*:*:*:*');
    expect(root.author).toBe('Jane');
    expect(root.supplier).toBe('Acme Inc');
    expect(root.homepageUrl).toBe('https://acme.test');
    expect(root.repoUrl).toBe('https://git.acme.test');
    expect(root.distributionUrl).toBe('https://dl.acme.test');
    expect(root.checksum).toBe('a'.repeat(64));
    expect(root.licenses[0].name).toBe('MIT');
  });

  it('still maps legacy 1.2-1.6 the same way', () => {
    ['1.2', '1.3', '1.4', '1.5', '1.6'].forEach((v) => {
      const {scan} = reader.parseBom(bom(v, components, deps), {query: {}});
      expect(scan.dependencies[0].name).toBe('app');
      expect(scan.dependencies[0].private).toBeUndefined();
    });
  });

  it('recognizes non-core 1.7 component types (file/data/device/...) as real deps', () => {
    // machine-learning-model is round-tripped separately (into aiProperties), like
    // cryptographic-asset, so it is intentionally excluded from this list.
    ['container', 'platform', 'operating-system', 'device', 'device-driver',
      'firmware', 'file', 'data'].forEach((type) => {
      const comp = {'bom-ref': 'pkg:generic/thing@1', type, name: 'thing', version: '1',
        purl: 'pkg:generic/thing@1'};
      const {scan} = reader.parseBom(bom('1.7', [comp], []), {query: {}});
      expect(scan.dependencies[0].name).toBe('thing');
      expect(scan.dependencies[0].private).toBeUndefined();
    });
  });
});

describe('cyclonedx/reader.parseBom - AIBOM (machine-learning-model) round-trip', () => {
  it('parses machine-learning-model components into ai payloads (with modelCard passthrough)', () => {
    const aibom = bom('1.7', [
      {'bom-ref': 'ml/gpt', type: 'machine-learning-model', name: 'GPT-Mini',
        version: '1.0', publisher: 'OpenAI',
        modelCard: {modelParameters: {task: 'text-generation', architectureFamily: 'transformer'},
          considerations: {ethicalConsiderations: [{name: 'bias'}]}}}
    ], []);
    const {scan, ai} = reader.parseBom(aibom, {query: {}});
    // ML model is NOT a regular dependency
    expect(scan.dependencies.length).toBe(0);
    expect(ai.length).toBe(1);
    const model = ai[0];
    expect(model.name).toBe('GPT-Mini');
    expect(model.type).toBe('machine-learning-model');
    expect(model.version).toBe('1.0');
    expect(model.provider).toBe('OpenAI');
    expect(model.task).toBe('text-generation');
    // raw modelCard preserved verbatim
    expect(model.modelCard.considerations.ethicalConsiderations[0].name).toBe('bias');
  });

  it('keeps software dependencies of a root machine-learning-model (AIBOM scan is not empty)', () => {
    // Canonical AIBOM shape (manifest-cyber examples): the model is the graph root and its
    // frameworks hang beneath it. The model is contracted into the ai payload, but its
    // software children must survive as scan dependencies rather than be orphaned.
    const aibom = {
      bomFormat: 'CycloneDX', specVersion: '1.7',
      metadata: {component: {type: 'machine-learning-model', name: 'SD-XL', version: '1.0', 'bom-ref': 'ml-root'}},
      components: [
        {'bom-ref': 'ml-root', type: 'machine-learning-model', name: 'SD-XL', version: '1.0',
          modelCard: {modelParameters: {task: 'text-to-image'}}},
        {'bom-ref': 'onnx', type: 'library', name: 'ONNX', version: '1.16', purl: 'pkg:pypi/onnx@1.16'},
        {'bom-ref': 'torch', type: 'library', name: 'PyTorch', version: '2.0', purl: 'pkg:pypi/torch@2.0'}
      ],
      dependencies: [{ref: 'ml-root', dependsOn: ['onnx', 'torch']}]
    };
    const {scan, ai} = reader.parseBom(aibom, {query: {}});
    expect(scan.dependencies.map((d) => d.name).sort()).toEqual(['ONNX', 'PyTorch']);
    // the model is captured once (deduped) as an AI artifact, with its modelCard
    expect(ai.length).toBe(1);
    expect(ai[0].name).toBe('SD-XL');
    expect(ai[0].modelCard.modelParameters.task).toBe('text-to-image');
  });

  it('attaches a graph-linked ml-model to the component as ai_models', () => {
    const comps = [
      {'bom-ref': 'pkg:npm/app@1.0.0', type: 'application', name: 'app', version: '1.0.0', purl: 'pkg:npm/app@1.0.0'},
      {'bom-ref': 'ml/gpt', type: 'machine-learning-model', name: 'GPT-Mini', version: '1.0'}
    ];
    const deps = [{ref: 'pkg:npm/app@1.0.0', dependsOn: ['ml/gpt']}];
    const {scan, ai} = reader.parseBom(bom('1.7', comps, deps), {query: {}});
    const root = scan.dependencies[0];
    expect(root.name).toBe('app');
    expect(root.ai_models).toEqual([{name: 'GPT-Mini', type: 'machine-learning-model', version: '1.0'}]);
    // the ml model must NOT appear as a regular dependency node
    expect(scan.dependencies.find((d) => d.name === 'GPT-Mini')).toBeUndefined();
    expect(ai.map((a) => a.name)).toEqual(['GPT-Mini']);
  });
});

describe('cyclonedx/writer - AIBOM variant', () => {
  it('emits machine-learning-model components for the AIBOM variant and excludes them from SBOM', () => {
    const writer = require('../../imports/lib/cyclonedx/writer');
    const report = {
      tree: {dependencies: [
        {name: 'app', key: 'npm:app', versions: ['1.0.0'],
          ai_models: [{name: 'GPT-Mini', type: 'machine-learning-model', version: '1.0', provider: 'OpenAI', task: 'text-generation'}],
          dependencies: []}
      ]},
      company: {name: 'Acme'}
    };
    const aibom = writer.buildDocument(report, 'AIBOM');
    const ml = aibom.components.filter((c) => c.type === 'machine-learning-model');
    expect(ml.length).toBe(1);
    expect(ml[0].name).toBe('GPT-Mini');
    expect(ml[0].publisher).toBe('OpenAI');
    expect(ml[0].modelCard.modelParameters.task).toBe('text-generation');
    // SBOM variant must NOT contain the ml model
    const sbom = writer.buildDocument(report, 'SBOM');
    expect(sbom.components.find((c) => c.type === 'machine-learning-model')).toBeUndefined();
  });

  it('emits managed AI artifacts (aiProperties) not linked to any component', () => {
    const writer = require('../../imports/lib/cyclonedx/writer');
    const report = {
      tree: {dependencies: []},
      aiProperties: {project: [{name: 'BERT', projectId: 'p1', version: '2.0', task: 'classification'}]},
      company: {name: 'Acme'}
    };
    const aibom = writer.buildDocument(report, 'AIBOM');
    const ml = aibom.components.filter((c) => c.type === 'machine-learning-model');
    expect(ml.length).toBe(1);
    expect(ml[0].name).toBe('BERT');
    expect(ml[0].modelCard.modelParameters.task).toBe('classification');
  });
});

const writer = require('../../imports/lib/cyclonedx/writer');

describe('cyclonedx/reader.parseBom - crypto round-trip', () => {
  it('parses cryptographic-asset components back into CryptoProperties payloads', () => {
    const cdoc = {
      type: 'cryptographic-asset', name: 'AES', 'bom-ref': 'AES',
      cryptoProperties: {assetType: 'algorithm',
        algorithmProperties: {primitive: 'block-cipher', mode: 'gcm'}}
    };
    const cert = {
      type: 'cryptographic-asset', name: 'MyCert', 'bom-ref': 'MyCert',
      cryptoProperties: {assetType: 'certificate',
        certificateProperties: {subjectName: 'CN=acme', certificateState: [{state: 'active'}]}}
    };
    const cbom = {bomFormat: 'CycloneDX', specVersion: '1.7',
      components: [cdoc, cert], dependencies: []};
    const {crypto} = reader.parseBom(cbom, {query: {}});
    const byName = {};
    crypto.forEach((c) => { byName[c.name] = c; });
    expect(byName.AES.assetType).toBe('algorithm');
    expect(byName.AES.algorithmProperties.mode).toBe('gcm');
    expect(byName.MyCert.assetType).toBe('certificate');
    expect(byName.MyCert.certificateProperties.subjectName).toBe('CN=acme');
  });

  it('round-trips writer CBOM output back to crypto payloads', () => {
    const report = {
      cryptoProperties: {modA: [
        {name: 'AES', assetType: 'algorithm',
          algorithmProperties: {primitive: 'block-cipher', mode: 'gcm',
            cryptoFunctions: ['encrypt'], classicalSecurityLevel: '128'}}
      ]},
      tree: {dependencies: [{name: 'app', key: 'npm:app', version: '1.0.0',
        moduleId: 'modA', crypto_algorithms: [{algorithm: 'AES'}], dependencies: []}]}
    };
    const cbom = writer.buildDocument(report, 'CBOM');
    const {crypto} = reader.parseBom(cbom, {query: {}});
    const aes = crypto.find((c) => c.name === 'AES');
    expect(aes.assetType).toBe('algorithm');
    expect(aes.algorithmProperties.primitive).toBe('block-cipher');
    expect(aes.algorithmProperties.classicalSecurityLevel).toBe(128); // writer coerced int
  });
});

describe('cyclonedx/reader.parseBom - crypto component linkage', () => {
  const app = {
    'bom-ref': 'pkg:npm/app@1.0.0', type: 'application', name: 'app',
    version: '1.0.0', purl: 'pkg:npm/app@1.0.0'
  };
  const lib = {
    'bom-ref': 'pkg:npm/lib@2.0.0', type: 'library', name: 'lib',
    version: '2.0.0', purl: 'pkg:npm/lib@2.0.0'
  };
  const aes = {
    'bom-ref': 'crypto/AES', type: 'cryptographic-asset', name: 'AES',
    cryptoProperties: {assetType: 'algorithm',
      algorithmProperties: {primitive: 'block-cipher', mode: 'gcm'}}
  };
  const orphan = {
    'bom-ref': 'crypto/SHA256', type: 'cryptographic-asset', name: 'SHA-256',
    cryptoProperties: {assetType: 'algorithm', algorithmProperties: {primitive: 'hash'}}
  };

  it('attaches a graph-linked crypto asset to the component as crypto_algorithms', () => {
    const deps = [
      {ref: 'pkg:npm/app@1.0.0', dependsOn: ['pkg:npm/lib@2.0.0', 'crypto/AES']},
      {ref: 'pkg:npm/lib@2.0.0', dependsOn: []}
    ];
    const {scan} = reader.parseBom(bom('1.7', [app, lib, aes], deps), {query: {}});
    const root = scan.dependencies[0];
    expect(root.name).toBe('app');
    expect(root.crypto_algorithms).toEqual([{algorithm: 'AES'}]);
    // the crypto asset must NOT appear as a regular dependency node
    expect(root.dependencies.map((d) => d.name)).toEqual(['lib']);
  });

  it('does NOT attach unreferenced (orphan) crypto assets to any component', () => {
    const deps = [
      {ref: 'pkg:npm/app@1.0.0', dependsOn: ['pkg:npm/lib@2.0.0', 'crypto/AES']},
      {ref: 'pkg:npm/lib@2.0.0', dependsOn: []}
    ];
    const {scan, crypto} = reader.parseBom(
      bom('1.7', [app, lib, aes, orphan], deps), {query: {}});
    const root = scan.dependencies[0];
    expect(root.crypto_algorithms).toEqual([{algorithm: 'AES'}]);
    // orphan still parsed into module-level crypto payloads, just not linked
    expect(crypto.map((c) => c.name).sort()).toEqual(['AES', 'SHA-256']);
  });
});

describe('cyclonedx/writer - component->crypto dependency edge', () => {
  it('emits a dependencies edge from the component to its crypto asset (combined variant)', () => {
    const report = {
      cryptoProperties: {modA: [
        {name: 'AES', 'bom-ref': 'crypto/AES', assetType: 'algorithm',
          algorithmProperties: {primitive: 'block-cipher', mode: 'gcm'}}
      ]},
      tree: {dependencies: [{name: 'app', key: 'npm:app', version: '1.0.0',
        moduleId: 'modA', crypto_algorithms: [{algorithm: 'AES'}], dependencies: []}]}
    };
    // undefined variant = "All" - the only variant that emits both components and crypto
    const cbom = writer.buildDocument(report);
    const appComp = cbom.components.find((c) => c.name === 'app');
    const aesComp = cbom.components.find((c) => c.name === 'AES');
    expect(appComp).toBeTruthy();
    expect(aesComp).toBeTruthy();
    const edge = cbom.dependencies.find((d) =>
      d.ref === appComp['bom-ref'] && d.dependsOn.indexOf(aesComp['bom-ref']) !== -1);
    expect(edge).toBeTruthy();
  });

  it('full round-trip: writer edge -> reader re-attaches crypto_algorithms to the component', () => {
    const report = {
      cryptoProperties: {modA: [
        {name: 'AES', 'bom-ref': 'crypto/AES', assetType: 'algorithm',
          algorithmProperties: {primitive: 'block-cipher', mode: 'gcm'}}
      ]},
      tree: {dependencies: [{name: 'app', key: 'npm:app', version: '1.0.0',
        purl: 'pkg:npm/app@1.0.0', moduleId: 'modA',
        crypto_algorithms: [{algorithm: 'AES'}], dependencies: []}]}
    };
    const cbom = writer.buildDocument(report); // combined variant carries components + crypto + edge
    const {scan} = reader.parseBom(cbom, {query: {}});
    const root = scan.dependencies.find((d) => d.name === 'app');
    expect(root).toBeTruthy();
    expect(root.crypto_algorithms).toEqual([{algorithm: 'AES'}]);
  });
});

describe('cyclonedx/reader.parseBom - cyclic dependency graphs', () => {
  const lib = (ref) => ({
    'bom-ref': ref, type: 'library', name: ref, version: '1.0.0',
    purl: `pkg:npm/${ref}@1.0.0`, licenses: [{license: {id: 'MIT'}}]
  });
  const bom = (components, dependencies) =>
    ({bomFormat: 'CycloneDX', specVersion: '1.6', components, dependencies});

  // Walks the emitted graph exactly like every consumer does (ImportConverter's license
  // preprocessing, processScan's handleDependency, JSON.stringify): plain recursion with no
  // visited set. A back edge makes that walk never terminate.
  function walk(dependencies, ancestors, names) {
    (dependencies || []).forEach((node) => {
      if (ancestors.indexOf(node) !== -1) {
        throw new Error(`cycle: ${node.name} is its own ancestor`);
      }
      names.push(node.name);
      walk(node.dependencies, ancestors.concat([node]), names);
    });
    return names;
  }
  const walkAll = (scan) => walk(scan.dependencies, [], []);

  it('emits an acyclic tree when the BOM dependency graph has a cycle', () => {
    const {scan} = reader.parseBom(bom(
      [lib('app'), lib('a'), lib('b')],
      [{ref: 'app', dependsOn: ['a']},
        {ref: 'a', dependsOn: ['b']},
        {ref: 'b', dependsOn: ['a']}]        // a <-> b
    ), {query: {}});
    const names = walkAll(scan);
    expect(names).toContain('a');
    expect(names).toContain('b');
  });

  it('keeps components whose only edges form a cycle (no acyclic parent)', () => {
    const {scan} = reader.parseBom(bom(
      [lib('a'), lib('b')],
      [{ref: 'a', dependsOn: ['b']}, {ref: 'b', dependsOn: ['a']}]
    ), {query: {}});
    const names = walkAll(scan);
    expect(names).toContain('a');
    expect(names).toContain('b');
  });

  it('drops a self-referencing edge but keeps the component', () => {
    const {scan} = reader.parseBom(bom(
      [lib('a')], [{ref: 'a', dependsOn: ['a']}]
    ), {query: {}});
    expect(walkAll(scan)).toEqual(['a']);
  });

  it('emits a diamond as a tree: the repeat occurrence is its own leaf node', () => {
    const {scan} = reader.parseBom(bom(
      [lib('app'), lib('a'), lib('b'), lib('d')],
      [{ref: 'app', dependsOn: ['a', 'b']},
        {ref: 'a', dependsOn: ['d']},
        {ref: 'b', dependsOn: ['d']}]
    ), {query: {}});
    expect(walkAll(scan).sort()).toEqual(['a', 'app', 'b', 'd', 'd']);
    const [underA, underB] = scan.dependencies[0].dependencies.map((n) => n.dependencies[0]);
    expect(underA).not.toBe(underB);            // no object shared between two parents
    expect(underA.key).toBe(underB.key);        // same component, both edges kept
  });

  // A chain of N diamonds has 2^N distinct root->leaf paths; sharing one node object between
  // both parents makes any tree walk (processScan, JSON.stringify) take 2^N steps.
  it('stays linear on a graph with exponentially many paths', () => {
    const components = [];
    const dependencies = [];
    const N = 40;
    for (let i = 0; i < N; i++) {
      components.push(lib(`L${i}`), lib(`a${i}`), lib(`b${i}`));
      dependencies.push({ref: `L${i}`, dependsOn: [`a${i}`, `b${i}`]});
      dependencies.push({ref: `a${i}`, dependsOn: [`L${i + 1}`]});
      dependencies.push({ref: `b${i}`, dependsOn: [`L${i + 1}`]});
    }
    components.push(lib(`L${N}`));
    const {scan} = reader.parseBom(bom(components, dependencies), {query: {}});
    expect(walkAll(scan).length).toBeLessThan(10 * N);
  });
});

describe('cyclonedx/reader.parseBom - untrusted BOM input (import API surface)', () => {
  const lib = (ref) => ({
    'bom-ref': ref, type: 'library', name: ref, version: '1.0.0', purl: `pkg:npm/${ref}@1.0.0`
  });
  const bom = (components, dependencies) =>
    ({bomFormat: 'CycloneDX', specVersion: '1.6', components, dependencies});

  function measure(scan) {
    let nodes = 0;
    let maxDepth = 0;
    const names = new Set();
    (function walk(list, depth) {
      (list || []).forEach((node) => {
        nodes++;
        names.add(node.name);
        if (depth > maxDepth) maxDepth = depth;
        walk(node.dependencies, depth + 1);
      });
    })(scan.dependencies, 1);
    return {nodes, maxDepth, names};
  }

  // 5000 components is ~625 KB, well inside the 5 MB body limit the import routes accept.
  it('survives a dependency chain long enough to overflow a recursive builder', () => {
    const components = [];
    const dependencies = [];
    const N = 5000;
    for (let i = 0; i < N; i++) {
      components.push(lib(`c${i}`));
      if (i < N - 1) dependencies.push({ref: `c${i}`, dependsOn: [`c${i + 1}`]});
    }
    const {scan} = reader.parseBom(bom(components, dependencies), {query: {}});
    const {names, maxDepth} = measure(scan);
    expect(names.size).toBe(N);                  // no component dropped, just re-rooted
    expect(maxDepth).toBeLessThanOrEqual(40);    // storable: MongoDB rejects past ~89 levels
  });

  it('survives a long chain of contracted crypto assets', () => {
    const components = [lib('app')];
    const dependencies = [{ref: 'app', dependsOn: ['a0']}];
    const N = 5000;
    for (let i = 0; i < N; i++) {
      components.push({'bom-ref': `a${i}`, type: 'cryptographic-asset', name: `alg${i}`,
        cryptoProperties: {assetType: 'algorithm'}});
      if (i < N - 1) dependencies.push({ref: `a${i}`, dependsOn: [`a${i + 1}`]});
    }
    const {scan, crypto} = reader.parseBom(bom(components, dependencies), {query: {}});
    expect(scan.dependencies[0].name).toBe('app');
    expect(crypto.length).toBe(N);
  });
});

describe('cyclonedx/reader.parseBom - real distro SBOM regression (tests/cydx)', () => {
  // Container SBOM that crashed ModuleImports.ImportModule with "Maximum call stack size
  // exceeded": its graph carries the usual glibc cycles (libc6 <-> libgcc-s1, libc6 <->
  // libcrypt1) and enough shared nodes for a path-wise walk to reach ~3.2e9 visits.
  const body = require('../../tests/cydx/test-cydx-cyclic-distro-sbom.json');

  it('imports as a finite, storable, acyclic tree', () => {
    const {scan} = reader.parseBom(body, {query: {}});
    const keys = new Set();
    let nodes = 0;
    let maxDepth = 0;
    (function walk(list, ancestors, depth) {
      (list || []).forEach((node) => {
        if (ancestors.indexOf(node) !== -1) throw new Error(`cycle at ${node.name}`);
        nodes++;
        keys.add(node.key);
        if (depth > maxDepth) maxDepth = depth;
        walk(node.dependencies, ancestors.concat([node]), depth + 1);
      });
    })(scan.dependencies, [], 1);
    expect(keys.size).toBe(body.components.length + 1);   // + metadata.component
    expect(nodes).toBeLessThan(5000);                     // bounded by edges, not by paths
    expect(maxDepth).toBeLessThanOrEqual(40);
    expect(JSON.stringify(scan).length).toBeLessThan(16 * 1024 * 1024);  // fits a Mongo doc
  });
});
