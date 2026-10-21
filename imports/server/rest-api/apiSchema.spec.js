
import {ApiDependencySchema, ApiScanSchema, helpers} from './apiSchema';
import {expect} from 'chai';

const ADMIN_USER = 'admin-user'
const UNEXPECTED_VALIDATION = 'Unexpected validation error "ApiSchemaHelper.cleanAndValidateDependency"'

describe('ApiDependencySchema', function () {

  it('should validate a valid object', function () {

    const dependency = {
      name: 'component',
      key: 'npm:key',
      versions: ['1.2.3'],
      dependencies: [{name: 'child ', key: 'childKey', versions: ['1.1.0']}]
    };

    const context = ApiDependencySchema.newContext();
    context.validate(dependency);
    if (!context.isValid()) {
      console.log('Unexpected validation error "ApiDependencySchema"', context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });

  it('should validate a valid object with purl', function () {

    const dependency = {
      name: 'component',
      purl: 'pkg:npm/foobar@12.3.1',
      versions: ['1.2.3'],
      dependencies: [{name: 'child ', key: 'childKey', versions: ['1.1.0']}]
    };

    const context = ApiDependencySchema.newContext();
    context.validate(dependency);
    if (!context.isValid()) {
      console.log('Unexpected validation error "ApiDependencySchema" with purl', context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });

  it('should clean valid objects and remove undefined version array members', function () {

    const dependency = {
      name: ' component ',
      key: ' npm:key ',
      versions: ['1.2.3  ', '  ', ' 4.5.6 '],
      private: true,
      homepageUrl: 'http://www.home.com',
      repoUrl: 'git://www.github.com',
      unwanted: 'bliblablub',
      dependencies: [{}]
    };

    ApiDependencySchema.clean(dependency, {mutate: true});

    expect(dependency).to.be.deep.equal({
      name: 'component',
      key: 'npm:key',
      versions: ['1.2.3', '4.5.6'],
      private: true,
      homepageUrl: 'http://www.home.com',
      repoUrl: 'git://www.github.com',
      dependencies: [{}]
    });

    const context = ApiDependencySchema.newContext();
    context.validate(dependency);
    if (!context.isValid()) {
      console.log('Unexpected validation error "ApiDependencySchema"', context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });
});

describe('ApiScanSchema', function () {

  it('should validate a valid object', function () {

    const scan = {
      user: ADMIN_USER,
      project: 'project',
      module: 'module',
      moduleId: 'moduleId',
      dependencies: [{}]
    };

    const context = ApiScanSchema.newContext();
    context.validate(scan);
    if (!context.isValid()) {
      console.log('Unexpected validation error "ApiScanSchema"', context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });

  it('should clean valid objects', function () {

    const scan = {
      user: '   admin-user   ',
      project: ' project ',
      module: 'module ',
      moduleId: ' moduleId',
      unwanted: 'bliblablub',
      dependencies: [{}]
    };

    ApiScanSchema.clean(scan, {mutate: true});

    expect(scan).to.be.deep.equal({
      user: ADMIN_USER,
      project: 'project',
      module: 'module',
      moduleId: 'moduleId',
      dependencies: [{}]
    });

    const context = ApiScanSchema.newContext();
    context.validate(scan);
    if (!context.isValid()) {
      console.log('Unexpected validation error "ApiScanSchema"', context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });
});

describe('ApiSchemaHelper.cleanAndValidateDependency()', function () {
  it('should validate dependency and nested objects', function () {
    const dependency = {
      name: 'component',
      key: 'npm:key',
      versions: ['1.2.3'],
      dependencies: [{name: 'child1', key: 'npm:childKey1', versions: ['0.1.2']},
        {
          name: 'child2', key: 'npm:childKey2', versions: ['0.0.1'], dependencies: [
            {name: 'grandchild1', key: 'npm:grandchildKey1', versions: ['0.1.x']}]
        }]
    };
    const context = helpers.cleanAndValidateDependency(dependency);

    if (!context.isValid()) {
      console.log(UNEXPECTED_VALIDATION,
        context.__errorObject,
        context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });

  it('should validate dependency by removing invalid repoUrl', function () {
    const dependency = {
      name: 'component',
      key: 'npm:key',
      repoUrl: 'keineAhnung',
      versions: ['1.2.3']
    };
    const context = helpers.cleanAndValidateDependency(dependency);

    if (!context.isValid()) {
      console.log(UNEXPECTED_VALIDATION,
        context.__errorObject,
        context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });

  it('should validate dependency by removing invalid licenseUrl', function () {
    const dependency = {
      name: 'component',
      key: 'npm:key',
      licenses: [{url: 'invalid'}],
      versions: ['1.2.3']
    };
    const context = helpers.cleanAndValidateDependency(dependency);

    expect(dependency.licenses.length).to.be.equal(0);

    if (!context.isValid()) {
      console.log(UNEXPECTED_VALIDATION,
        context.__errorObject,
        context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });
});

describe('ApiSchemaHelper.cleanAndValidateScan()', function () {
  it('should validate scan and nested objects', function () {
    const scan = {
      user: 'developer@example.com',
      project: 'killerApp',
      module: 'simpleModule',
      moduleId: 'simpleModuleId',
      dependencies: [{name: 'root', key: 'key', versions: ['0.1.2']}]
    };
    const context = helpers.cleanAndValidateScan(scan);

    if (!context.isValid()) {
      console.log(UNEXPECTED_VALIDATION,
        context.__errorObject,
        context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });

  // Regression: `dependencies` is declared as `{type: [Object], blackbox: true}`.
  // The array shorthand expands to `dependencies` + `dependencies.$`, and if
  // `blackbox` does not travel to the item definition, allowsKey() rejects every
  // `dependencies.$.<prop>` and clean({filter: true}) strips each dependency down
  // to `{}`, which is then dropped as an empty object, leaving `dependencies: []`.
  // The scan still validates (minCount: 0, optional), so POST /api/v2/core/scans
  // answers 201 while persisting a scan with no components at all.
  it('should preserve the whole nested dependency tree', function () {
    const scan = {
      project: 'killerApp',
      module: 'simpleModule',
      moduleId: 'npm:simpleModule',
      dependencies: [{
        name: 'root',
        key: 'npm:root',
        versions: ['0.0.0'],
        licenses: [],
        meta: {purl: 'pkg:npm/root@0.0.0'},
        dependencies: [{
          name: 'child',
          key: 'npm:child',
          versions: ['1.2.3'],
          dependencies: [{
            name: 'grandchild',
            key: 'npm:grandchild',
            versions: ['4.5.6'],
            dependencies: []
          }]
        }]
      }]
    };

    const context = helpers.cleanAndValidateScan(scan);

    if (!context.isValid()) {
      console.log(UNEXPECTED_VALIDATION,
        context.__errorObject,
        context.validationErrors());
    }
    expect(context.isValid()).to.be.true;

    expect(scan.dependencies.length).to.be.equal(1);

    const root = scan.dependencies[0];
    expect(root.name).to.be.equal('root');
    expect(root.key).to.be.equal('npm:root');
    expect(root.versions).to.be.deep.equal(['0.0.0']);
    expect(root.meta).to.be.deep.equal({purl: 'pkg:npm/root@0.0.0'});

    const child = root.dependencies[0];
    expect(child.name).to.be.equal('child');
    expect(child.key).to.be.equal('npm:child');

    const grandchild = child.dependencies[0];
    expect(grandchild.name).to.be.equal('grandchild');
    expect(grandchild.versions).to.be.deep.equal(['4.5.6']);
  });

  // Same shorthand, same failure mode: these carry the imported CycloneDX
  // crypto-asset / ML-model payloads that handlePost hands to
  // CryptoPropertiesPersistImported / AiPropertiesPersistImported.
  it('should preserve cryptoProperties and aiProperties payloads', function () {
    const scan = {
      project: 'killerApp',
      module: 'simpleModule',
      cryptoProperties: [{assetType: 'algorithm', algorithmProperties: {primitive: 'ae'}}],
      aiProperties: [{name: 'some-model', modelCard: {quantitativeAnalysis: {}}}]
    };

    const context = helpers.cleanAndValidateScan(scan);

    expect(context.isValid()).to.be.true;
    expect(scan.cryptoProperties).to.be.deep.equal(
      [{assetType: 'algorithm', algorithmProperties: {primitive: 'ae'}}]);
    expect(scan.aiProperties).to.be.deep.equal(
      [{name: 'some-model', modelCard: {quantitativeAnalysis: {}}}]);
  });
});

describe('ApiSchemaHelper.cleanAndValidateDependency() nesting', function () {
  // handlePost runs cleanAndValidateDependency() over every top-level dependency,
  // mutating it in place, so ApiDependencySchema.dependencies has to survive the
  // same array-shorthand blackbox expansion as ApiScanSchema.dependencies.
  it('should preserve nested children when cleaning a dependency', function () {
    const dependency = {
      name: 'root',
      key: 'npm:root',
      versions: ['0.0.0'],
      dependencies: [{
        name: 'child',
        key: 'npm:child',
        versions: ['1.2.3'],
        dependencies: [{name: 'grandchild', key: 'npm:grandchild', versions: ['4.5.6']}]
      }]
    };

    const context = helpers.cleanAndValidateDependency(dependency);

    if (!context.isValid()) {
      console.log(UNEXPECTED_VALIDATION,
        context.__errorObject,
        context.validationErrors());
    }
    expect(context.isValid()).to.be.true;

    expect(dependency.dependencies.length).to.be.equal(1);
    expect(dependency.dependencies[0].name).to.be.equal('child');
    expect(dependency.dependencies[0].dependencies[0].name).to.be.equal('grandchild');
  });

  // createOKResponse() turns `__errorObject` into the response `warning`, so a valid tree
  // must not carry one. The grandchild above omits `dependencies` entirely - the shape that
  // used to be stamped as if it had failed, because the stamp keyed off "did not recurse"
  // rather than "is invalid".
  it('should leave no error object on a fully valid tree whose leaf omits dependencies', function () {
    const dependency = {
      name: 'root', key: 'npm:root', versions: ['0.0.0'],
      dependencies: [{name: 'leaf', key: 'npm:leaf', versions: ['1.2.3']}]
    };

    const context = helpers.cleanAndValidateDependency(dependency);

    expect(context.isValid()).to.be.true;
    expect(context.__errorObject).to.be.undefined;
  });

  it('should leave no error object on a valid dependency with no children at all', function () {
    const dependency = {name: 'solo', key: 'npm:solo', versions: ['1.0.0']};

    const context = helpers.cleanAndValidateDependency(dependency);

    expect(context.isValid()).to.be.true;
    expect(context.__errorObject).to.be.undefined;
  });

  it('should leave no error object when every leaf carries an empty dependencies array', function () {
    const dependency = {
      name: 'root', key: 'npm:root', versions: ['0.0.0'],
      dependencies: [{name: 'leaf', key: 'npm:leaf', versions: ['1.2.3'], dependencies: []}]
    };

    const context = helpers.cleanAndValidateDependency(dependency);

    expect(context.isValid()).to.be.true;
    expect(context.__errorObject).to.be.undefined;
  });

  // The other direction: an invalid node still has to be named exactly, since that string is
  // the whole content of the response warning. `zzz` is not an allowed package type.
  it('should name the invalid descendant in the error object', function () {
    const dependency = {
      name: 'root', key: 'npm:root', versions: ['0.0.0'],
      dependencies: [{
        name: 'child', key: 'npm:child', versions: ['1.2.3'],
        dependencies: [{name: 'gc-invalid', key: 'zzz:rejected', versions: ['4.5.6'], dependencies: []}]
      }]
    };

    const context = helpers.cleanAndValidateDependency(dependency);

    expect(context.isValid()).to.be.false;
    expect(context.__errorObject).to.be.equal('Dependency:gc-invalid');
    expect(context.validationErrors()[0].name).to.be.equal('key');
  });
});
