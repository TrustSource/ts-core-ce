import {Meteor} from 'meteor/meteor';
import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import _ from 'underscore';
import {CHECKSUM_REGEX} from '/imports/lib/component/checksumFormat';
import {BinaryLinkSchema} from '/imports/lib/schemas/binaryLinkSchema';
import {SarifSchema} from '/imports/lib/schemas/import/sarifSchema';
import {CycloneDXSchema} from '/imports/lib/schemas/import/cycloneDXSchema';
import {SPDXSchema, SPDXJsonSchema} from '/imports/lib/schemas/import/spdxSchema';
import {SPDXParse} from '/imports/lib/spdx'
import { PackageURL } from 'packageurl-js';
import {preProcessLicenses} from '/imports/server/scan/processScan';
import {ProjectSchema} from '/imports/lib/schemas/projectSchema';
import {ModuleSchema} from '/imports/lib/schemas/moduleSchema';
import {RiskSchema, CountermeasureSchema} from '/imports/lib/schemas/riskSchema';
import Utils from '/imports/lib/utils';
import {TaskSchema} from '/imports/lib/schemas/taskSchema';

// Shared by ApiDependencySchema below AND by the fast path in cleanAndValidateDependency,
// so the schema and the direct check can never disagree about what a valid repo URL is.
/* eslint-disable max-len, sonarjs/regex-complexity, sonarjs/slow-regex */
const REPO_URL_REGEX = /^(?:(?:https?|ftp|ssh|git|svn):\/\/)(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/i;
/* eslint-enable max-len, sonarjs/regex-complexity, sonarjs/slow-regex */

// The URL regex SimpleSchema itself applies for `regEx: SimpleSchema.RegEx.Url`.
const GENERIC_URL_REGEX = SimpleSchema.RegEx.Url;

// Equivalent of `context.validateOne(doc, field)` for a field declared
// `{type: String, optional: true, regEx: R}` - which is all three URL fields here.
// validateOne on such a field can only fail two ways: the value is not a string, or it does
// not match R. Both are checked directly below.
//
// This exists because it is the hot path: cleanAndValidateDependency runs once per dependency
// node, and a 1000-dependency scan therefore made ~4000 validateOne calls. Measured, the bare
// regex costs ~1.7us while routing it through a SimpleSchema validation context costs ~33us -
// roughly 20x, for an identical answer.
function urlFieldIsValid(value, regex) {
  return typeof value === 'string' && regex.test(value);
}

// Whether a validated context reported an error for one particular field. `name` is the
// same key createOKResponse() puts into `warning.messages[].details.name`, so a field this
// answers true for is a field the client is already being told about.
function contextHasErrorFor(context, field) {
  const errors = context.validationErrors();
  return errors instanceof Array && errors.some(function (error) {
    return error && error.name === field;
  });
}

export const ApiLicenseSchema = new SimpleSchema({
  name: {
    type: String,
    optional: true,
    min: 3
  },
  kind: {
    type: String,
    optional: true
  },
  key: {
    type: String,
    optional: true
  },
  url: {
    type: String,
    optional: true,
    regEx: SimpleSchema.RegEx.Url
  }
});

export const ApiCryptoAlgorithmSchema = new SimpleSchema({
  algorithm: {
    type: String,
    optional: true
  },
  strength: {
    type: String,
    optional: true
  }
});

export const ApiDependencySchema = new SimpleSchema({
  name: {
    type: String,
    min: 1
  },
  key: {
    type: String,
    min: 4,
    regEx: new RegExp('^(' + Utils.getAllowedPackageTypes.concat(['im']).join('|') + ':).*$'),
    optional: true,
    custom: function () {
      if (!this.value && !this.field('purl').value) {
        return 'required';
      }
    }
  },
  purl: {
    type: String,
    optional: true,
    custom: function () {
      if (!this.value && !this.field('key').value) {
        return 'required';
      }
    }
  },
  versions: {
    type: [String],
    min: 0,
    autoValue: function () {          // remove all undefined array members during clean
      if (this.isSet && this.value instanceof Array) {
        const cleanArray = _.compact(this.value);
        return cleanArray.length !== this.value.length ? cleanArray : void 0;
      }
    },
    optional: true,
    custom: function () {
      if (!this.value && !this.field('purl').value) {
        return 'required';
      }
    }
  },
  description: {
    type: String,
    min: 1,
    optional: true
  },
  private: {
    type: Boolean,
    optional: true
  },
  licenses: {
    type: [ApiLicenseSchema],
    optional: true
  },
  scannedLicenses: {
    type: [ApiLicenseSchema],
    optional: true
  },
  homepageUrl: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  },
  repoUrl: {
    type: String,
    regEx: REPO_URL_REGEX,
    optional: true
  },
  dependencies: {
    type: [Object],
    optional: true,
    blackbox: true
  },
  checksum: {
    type: String,
    optional: true,
    min: 10,
    // Hex-only (10..128 chars) with an optional `<alg>:` prefix.
    //
    // What this actually protects is INTEGRITY DATA, not rendering: the value flows
    // through processScan into components.versions[].checksums[].checksum - a catalogue
    // shared by every tenant - and out again through SBOM, Notice, PDF and CycloneDX
    // exports, where a non-checksum reads as a checksum. (The stored-XSS claim this
    // comment used to make was overstated: Blaze escapes {{checksum}} in every template
    // that renders one.) A value that fails this regex is DROPPED in
    // cleanAndValidateDependency rather than merely reported, so it reaches neither the
    // stored scan nor the catalogue - and processScan applies the SAME constant at the two
    // catalogue write sites, so a pre-3.2.69 scan cannot carry one in through /reprocess.
    regEx: CHECKSUM_REGEX
  },
  meta: {
    type: Object,
    optional: true,
    blackbox: true
  },
  crypto_algorithms: {
    type: [ApiCryptoAlgorithmSchema],
    optional: true
  }
});

export const ContentNoticesSchema = new SimpleSchema({
  types: {
    type: Object,
    optional: true
  },
  notices: {
    type: Array,
    optional: true
  },
  'notices.$': {
    type: Object,
    optional: true
  }
});

export const ApiScanSchema = new SimpleSchema({
  user: {
    type: String,
    min: 1,
    optional: true
  },
  project: {
    type: String,
    min: 1
  },
  module: {
    type: String,
    min: 1
  },
  type: {
    type: String,
    optional: true
  },
  moduleId: {
    type: String,
    min: 1,
    optional: true
  },
  dependencies: {
    type: [Object],
    minCount: 0,        // validate during insert
    blackbox: true,
    optional: true
  },
  meta: {
    type: Object,
    optional: true,
    blackbox: true
  },
  crypto_algorithms: {
    type: [Object],
    optional: true
  },
  cryptoProperties: {
    // Imported CycloneDX cryptographic-asset payloads, persisted to the module then
    // stripped before the scan record is stored. See scans.js handlePost.
    type: [Object],
    blackbox: true,
    optional: true
  },
  aiProperties: {
    // Imported CycloneDX machine-learning-model payloads, persisted to the module then
    // stripped before the scan record is stored. See scans.js handlePost.
    type: [Object],
    blackbox: true,
    optional: true
  },
  release: {
    type: String,
    optional: true
  },
  branch: {
    type: String,
    optional: true
  },
  tag: {
    type: String,
    optional: true
  },
  binaryLinks: {
    type: [BinaryLinkSchema],
    optional: true
  },
  contentNotices: {
    type: ContentNoticesSchema,
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  }
});

export const ApiImportParamsSchema = new SimpleSchema({
  pkgType: {
    type: String,
    regEx: new RegExp('^(' + Utils.getAllowedPackageTypes.join('|') + ')$'),
    optional: true
  },
  version: {
    type: String,
    optional: true
  },
  project: {
    type: String
  },
  module: {
    type: String,
    optional: true
  },
  moduleId: {
    type: String,
    optional: true
  },
  scanId: {
    type: String,
    optional: true
  },
  analysisId: {
    type: String,
    optional: true
  },
  release: {
    type: String,
    optional: true
  },
  branch: {
    type: String,
    optional: true
  },
  tag: {
    type: String,
    optional: true
  },
  binaryLinks: {
    type: [BinaryLinkSchema],
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  }
});

export const ApiTestParamsSchema = new SimpleSchema({
  version: {
    type: String,
    optional: true
  },
  moduleId: {
    type: String,
    optional: true
  },
  scanId: {
    type: String,
    optional: true
  },
  analysisId: {
    type: String,
    optional: true
  },
  projectName: {
    type: String,
    optional: true
  },
  moduleName: {
    type: String,
    optional: true
  },
  release: {
    type: String,
    optional: true
  },
  branch: {
    type: String,
    optional: true
  },
  tag: {
    type: String,
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  }
});

export const ApiApprovesInitiateSchema = new SimpleSchema({
  scanId: {
    type: String,
    optional: false
  },
  name: {
    type: String
  },
  version: {
    type: String,
    optional: true
  },
  purl: {
    type: String,
    optional: true
  },
  description: {
    type: String,
    optional: true
  },
  draft: {
    type: Boolean,
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  }
});

export const ApiScanBinaryLinksSchema = new SimpleSchema({
  binaryLinks: {
    type: [BinaryLinkSchema],
    optional: true
  }
});

function replaceAll(str, list, replace) {
  let rezLine = str;
  if(rezLine){
    _.each(list, function (character) {
      rezLine = rezLine.replace(character, replace);
    });
  }
  return rezLine
}

export const helpers = {

  cleanAndValidateScan: function cleanAndValidateScan(scan) {

    ApiScanSchema.clean(scan, {mutate: true});

    let context = ApiScanSchema.newContext();
    context.validate(scan);
    if (!context.isValid()) {
      context.__errorObject = 'Scan:';
    }
    return context;
  },

  cleanAndValidateImport: function cleanAndValidateImport(type, data, params) {
    let context = {};
    let content;
    // SPDX RDF/XML documents arrive as a raw string and are parsed below via
    // SPDXParse, so a non-empty string is valid input for type 'spdx'. All other
    // types (and SPDX JSON) require a JSON object body.
    const isSpdxRdfString = type === 'spdx' && typeof data === 'string' && data.trim().length > 0;
    if (!isSpdxRdfString && (!data || typeof data !== 'object' || Array.isArray(data))) {
      let fallbackSchema = SarifSchema;
      if (type === 'cyclonedx') {
        fallbackSchema = CycloneDXSchema;
      } else if (type === 'spdx') {
        fallbackSchema = SPDXSchema;
      }
      context = fallbackSchema.newContext();
      context.validate({});
      context.__errorObject = `${type}:`;
      context.__errorDescription = 'Request body must be a non-empty JSON object';
      return context;
    }
    switch (type) {
    case 'sarif':
      delete data.$schema
      SarifSchema.clean(data, {mutate: true});
      context = SarifSchema.newContext();
      context.validate(data);
      if (!context.isValid()) {
        context.__errorObject = 'Sarif:';
      }
      break;
    case 'cyclonedx':
      delete data.$schema
      CycloneDXSchema.clean(data, {mutate: true});
      context = CycloneDXSchema.newContext();
      context.validate(data);
      if (!context.isValid()) {
        context.__errorObject = 'CycloneDX:';
      }
      break;
    case 'spdx':
      if(!params.format){
        params.format = 'json'
      }
      try{
        if(params.format === 'json'){
          content = data
          if(content){
            // Detect PascalCase (RDF-style) keys in JSON data
            const schema = content.DocumentNamespace || content.Package ? SPDXSchema : SPDXJsonSchema;
            schema.clean(content, {mutate: true});
            context = schema.newContext();
            context.validate(content);
            if (!context.isValid()) {
              context.__errorObject = 'SPDX:';
            }
          }
        }else if(params.format === 'rdf'){
          content = SPDXParse(data)
          if(content){
            SPDXSchema.clean(content, {mutate: true});
            context = SPDXSchema.newContext();
            context.validate(content);
            if (!context.isValid()) {
              context.__errorObject = 'SPDX:';
            }
          }
        }
      }catch (e) {
        context = SPDXSchema.newContext();
        context.validate({});
        context.__errorObject = 'SPDX:';
        context.__errorDescription = e.toString()
      }
      break;
    default:
      console.log('Not expected import type')
    }
    return context;
  },

  cleanAndValidateImportParams: function cleanAndValidateImportParams(data) {
    if (data && typeof data.demo === 'string') {     // query params arrive as strings
      data.demo = data.demo === 'true';
    }
    ApiImportParamsSchema.clean(data, {mutate: true});
    let context = ApiImportParamsSchema.newContext();
    context.validate(data);
    if (!context.isValid()) {
      context.__errorObject = 'ImportParams:';
    }
    return context;
  },

  cleanAndValidateTestParams: function cleanAndValidateTestParams(data) {
    if (data && typeof data.demo === 'string') {     // query params arrive as strings
      data.demo = data.demo === 'true';
    }
    ApiTestParamsSchema.clean(data, {mutate: true});
    let context = ApiTestParamsSchema.newContext();
    context.validate(data);
    if (!context.isValid()) {
      context.__errorObject = 'TestParams:';
    }
    return context;
  },

  cleanAndValidateApprovesInitiate: function cleanAndValidateApprovesInitiate(approve) {

    ApiApprovesInitiateSchema.clean(approve, {mutate: true});

    let context = ApiApprovesInitiateSchema.newContext();
    context.validate(approve);
    if (!context.isValid()) {
      context.__errorObject = 'Approve:';
    }
    return context;
  },

  cleanAndValidateScanBinaryLinks: function cleanAndValidateScanBinaryLinks(approve) {

    ApiScanBinaryLinksSchema.clean(approve, {mutate: true});

    let context = ApiScanBinaryLinksSchema.newContext();
    context.validate(approve);
    if (!context.isValid()) {
      context.__errorObject = 'Scan:';
    }
    return context;
  },

  cleanAndValidateDependency: function cleanAndValidateDependency(dependency) {
    let context = ApiDependencySchema.newContext();

    ApiDependencySchema.clean(dependency, {mutate: true});

    if(dependency.versions){
      dependency.versions = _.map(dependency.versions, function (version) {
        let pkgVersion;
        try {
          let pkg = PackageURL.fromString(version)
          if(pkg && pkg.version){
            pkgVersion = pkg.version;
          }
        // eslint-disable-next-line sonarjs/no-ignored-exceptions
        } catch (_e) { /* intentionally ignored */ }
        if(!pkgVersion && version.indexOf('pkg:') === 0){
          let parts = version.split('@')
          if(parts.length > 1){
            let subPart = parts[1].split('?')
            pkgVersion = subPart[0]
          }
        }
        return pkgVersion ? pkgVersion : replaceAll(version,['>','<','=','^','~'],'').trim()
      });
    }
    // special treatment for error prone repoUrl value: remove them if they will not validate
    if (dependency.repoUrl && !urlFieldIsValid(dependency.repoUrl, REPO_URL_REGEX)) {
      delete dependency.repoUrl;
    }
    // special treatment for error prone homepageUrl value: remove them if they will not validate
    if (dependency.homepageUrl && !urlFieldIsValid(dependency.homepageUrl, GENERIC_URL_REGEX)) {
      delete dependency.homepageUrl;
    }

    // special treatment for error prone license values, remove them if they will not validate
    if (dependency.licenses instanceof Array && dependency.licenses.length > 0) {
      dependency.licenses.forEach(function (license) {
        if (license.url && !urlFieldIsValid(license.url, GENERIC_URL_REGEX)) {
          delete license.url;
        }
      });  // remove empty objects from array
      for (let i = 0; i < dependency.licenses.length; i++) {
        if (_.isEmpty(dependency.licenses[i])) {
          dependency.licenses.splice(i, 1);
          i--;
        }
      }
    }

    context.validate(dependency);

    // Refuse-but-store was the bug: a checksum failing the regex above
    // was named in the response warning and persisted anyway - onto the scan and into
    // components.versions[].checksums[], which every tenant reads. Drop the value AFTER
    // validation: the context already holds the error, so the warning naming this node and
    // the `checksum` key is unchanged. Unlike the cosmetic repoUrl/homepageUrl drops above,
    // this one is about integrity data and about what the exports claim.
    if (contextHasErrorFor(context, 'checksum')) {
      delete dependency.checksum;
    }

    // `__errorObject` is what createOKResponse() turns into the response `warning`, so it
    // may only ever be stamped on an INVALID context. Stamping it whenever the recursion
    // did not descend also marked every valid leaf, and a valid leaf's context is what a
    // fully valid tree returns - so a clean scan reported a warning naming an arbitrary
    // leaf. It stayed hidden because ts-scan writes `dependencies: []` on leaves, which is
    // truthy and took the descend branch; a client that simply omits the key hit it.
    let firstInvalid = null;
    if (!context.isValid()) {
      context.__errorObject = 'Dependency:' + dependency.name;
      firstInvalid = context;
    }
    // The walk is UNCONDITIONAL, in both directions. This function is what cleans the
    // objects that get stored - the URL drops above, and now the checksum - so returning
    // early on an invalid node, or stopping at the first invalid child the way the old
    // `_.some` did, left the rest of the tree uncleaned: a second bad checksum elsewhere in
    // the payload was reported by nobody and stored by everybody. Only the REPORTING stops
    // at the first invalid node, in depth-first order.
    if (dependency.dependencies) {
      dependency.dependencies.forEach(function (child) {
        const childContext = cleanAndValidateDependency(child);
        if (!firstInvalid && !childContext.isValid()) {
          firstInvalid = childContext;
        }
      });
    }
    return firstInvalid || context;
  },

  validateDependencyLicenses: async function validateDependencyLicenses(dependency, privateLicenses) {
    let validationMessages = []
    dependency.scannedLicenses = dependency && dependency.licenses && JSON.parse(JSON.stringify(dependency.licenses))
    if (dependency && dependency.licenses instanceof Array && dependency.licenses.length > 0) {
      dependency.licenses = preProcessLicenses(dependency.licenses)
      for (const license of dependency.licenses) {
        if (license && license.name) {
          let licenseObj = null;
          if(privateLicenses && privateLicenses.length){
            let privateFounds = _.filter(privateLicenses, function (privateLicense) {
              return privateLicense.key === license.name
            });
            if(privateFounds.length){
              licenseObj = privateFounds
            }
          }
          if(!licenseObj){
            licenseObj = await Meteor.callAsync('getLicenseByNameOrKeyOrAlias',license.name);
            if(!licenseObj){
              validationMessages.push({
                name: 'Dependency: ' + dependency.name,
                type: 'unknownLicense',
                value: license.name
              })
            }
          }
        }
      }
    }
    if (dependency.dependencies) {
      for (const dep of dependency.dependencies) {
        let errors = await validateDependencyLicenses(dep, privateLicenses);
        _.each(errors, function (error) {
          validationMessages.push(error)
        });
      }
    }
    return validationMessages;
  },

  cleanAndValidateProject: function cleanAndValidateProject(project) {

    ProjectSchema.clean(project, {mutate: true});

    let context = ProjectSchema.newContext();
    context.validate(project);
    if (!context.isValid()) {
      context.__errorObject = 'Project:';
    }
    return context;
  },

  cleanAndValidateModule: function cleanAndValidateModule(module) {

    ModuleSchema.clean(module, {mutate: true});

    let context = ModuleSchema.newContext();
    context.validate(module);
    if (!context.isValid()) {
      context.__errorObject = 'Module:';
    }
    return context;
  },

  cleanAndValidateRisk: function cleanAndValidateProject(risk) {

    RiskSchema.clean(risk, {mutate: true});

    let context = RiskSchema.newContext();
    context.validate(risk);
    if (!context.isValid()) {
      context.__errorObject = 'Risk:';
    }
    return context;
  },

  cleanAndValidateTask: function cleanAndValidateProject(task) {

    TaskSchema.clean(task, {mutate: true});

    let context = TaskSchema.newContext();
    context.validate(task);
    if (!context.isValid()) {
      context.__errorObject = 'Task:';
    }
    return context;
  },

  cleanAndValidateCountermeasure: function cleanAndValidateCountermeasure(countermeasure) {

    CountermeasureSchema.clean(countermeasure, {mutate: true});

    let context = CountermeasureSchema.newContext();
    context.validate(countermeasure);
    if (!context.isValid()) {
      context.__errorObject = 'Countermeasure:';
    }
    return context;
  }
};
