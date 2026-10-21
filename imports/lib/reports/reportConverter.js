import { PackageURL } from 'packageurl-js';
import uuid from 'uuid';
import _ from 'underscore';
import cydxWriter from '/imports/lib/cyclonedx/writer';
import {Config} from '/imports/config';
// import {Validator} from 'jsonschema';
// keep in mind that external reverences like https://www.first.org/cvss/cvss-v2.0.json are removed
// import CYDX_SCHEMA from '/public/schemas/cyclonedx-1.6.schema.json';
// import CYDX_SCHEMA from '/public/schemas/cyclonedx-1.5.schema.json';
// import CYDX_SCHEMA from '/public/schemas/cyclonedx-1.4.schema.json';
// import CYDX_SCHEMA from '/public/schemas/cyclonedx-1.3.schema.json';
// import CYDX_SCHEMA from '/public/schemas/cyclonedx-1.2.schema.json';
// import SPDX_SCHEMA from '/public/schemas/spdx-2.3.1.schema';
// import SPDX_SCHEMA from '/public/schemas/spdx-2.3.schema';
// import SPDX_SCHEMA from '/public/schemas/spdx-2.2.2.schema';
// import SPDX_SCHEMA from '/public/schemas/spdx-2.2.1.schema';

const reportConverter = {
  bomToCycloneDX: bomToCycloneDX,
  bomToSPDX: bomToSPDX
};

export default reportConverter;

function bomToCycloneDX(report, type, params) {
  if(params.format === 'json'){
    // Delegated to the shared CycloneDX 1.7 writer. `type` is the variant
    // (undefined = All | 'SBOM' | 'CBOM'), matching existing callers.
    return cydxWriter.buildDocument(report, type);
  }
}

function bomToSPDX(report, params) {
  if(params.format === 'json'){
    const date = new Date();
    const spdx = {
      SPDXID: 'SPDXRef-DOCUMENT',
      spdxVersion: 'SPDX-2.3',
      creationInfo: {
        created: date.toISOString(),
        creators: [
          'Tool: ts-app'
        ],
        licenseListVersion: '2.5'
      },
      dataLicense: 'CC0-1.0'
    };
    if(report.company){
      spdx.creationInfo.creators.push(
        `Organization: ${report.company.name} (${report.company.distribution && report.company.distribution.email})`)
    }
    if (report.tree) {
      spdx.packages = [];
      spdx.relationships = [];
      report.tree.dependencies.forEach((child) => {
        handleDependency(spdx.packages, child, 'spdx', spdx.relationships, spdx, report.list, null);
      });
      if (spdx.packages.length > 0) {
        const first = spdx.packages[0] || report.module || report.project;
        const SPDXkey = getSpdxFormattedKey(first.name);
        const SPDXID = first.SPDXID || `SPDXRef-${SPDXkey}`;
        spdx.name = first.name || SPDXID;
        spdx.documentDescribes = [SPDXID];
        spdx.documentNamespace = `${Config.appUrl}spdx/${SPDXkey}`;
      }
    }
    // const v = new Validator();
    // console.log(v.validate(spdx, SPDX_SCHEMA))
    return spdx;
  }
}

function ComponentKey(key, parts) {
  if (!key || typeof key.split !== 'function') {
    // throw new Error('key must be a string');
  } else {
    parts = parts || { mgr: true, component: true, version: true };

    const partsCnt = (parts.mgr ? 1 : 0) + (parts.component ? 1 : 0) + (parts.version ? 1 : 0);
    const splitParts = key.split(':');
    // component may exist of more than one part
    if ((parts.component && splitParts.length < partsCnt) || (!parts.component && splitParts.length !== partsCnt)) {
      // throw new Error('invalid key format:' + key);
    } else {
      let compStartIdx = 0; let
        compEndIdx = splitParts.length;
      if (parts.mgr) {
         
        this.manager = splitParts[0];
         
        compStartIdx++;
      }
      if (parts.version) {
        this.version = splitParts[splitParts.length - 1];
         
        compEndIdx--;
      }
      if (parts.component) {
        this.component = '';
         
        for (let i = compStartIdx; i < compEndIdx; i++) {
          if (this.component) {
            this.component += ':';
          }
          this.component += splitParts[i];
        }
      }
    }
  }
}

function getPackageUrl(componentKey, version) {
  const result = new ComponentKey(componentKey, { mgr: true, component: true });
  if (result && result.component && result.manager !== 'im') {
    const parts = result.component.split(':');
    const org = parts.length > 1 ? parts[0] : null;
    const key = parts.length > 1 ? parts[1] : parts[0];
    if (key) {
      const purl = new PackageURL(result.manager, org, key, version)
      return purl.toString()
    }
    return null;
  }
  return null;
}

function getSpdxFormattedKey(componentKey) {
  return componentKey.split(' ').join('-').split(':').join('-').split('_').join('-');
}

function dependencyToCydxComponent(dependency) {
  const {
    name, key, description, homepageUrl, repoUrl, licenses, versions, version
  } = dependency;
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
    comp.licenses = [
      {
        license: {
          id: licenses[0].name
        }
      }
    ];
  }
  if (repoUrl) {
    comp.externalReferences.push({
      type: 'vcs',
      url: repoUrl
    });
  }
  if (homepageUrl) {
    comp.externalReferences.push({
      type: 'website',
      url: homepageUrl
    });
  }
  return comp;
}

function dependencyToSpdxComponent(dependency, listItem) {
  const {
    key, licenses, versions
  } = dependency;
  const {
    copyrightText, homepageUrl, version, repoUrl, licenseKey, license, packageFileName, summary,
    name, sourceInfo, originator, supplier, downloadLocation
  } = listItem || dependency ||{};
  const versionData = (versions && versions[0]) || version;
  const comp = {
    SPDXID: `SPDXRef-${getSpdxFormattedKey(key||name)}`,
    filesAnalyzed: false,
    name,
    versionInfo: versionData,
    packageFileName,
    summary,
    sourceInfo,
    originator,
    supplier,
    copyrightText: copyrightText || 'NOASSERTION',
    downloadLocation,
    externalRefs: []
  };
  let lic = (licenses && licenses[0] && licenses[0].key) || licenseKey || license || 'NOASSERTION'
  if (lic) {
    comp.licenseConcluded = lic;
    comp.licenseDeclared = lic;
    comp.licenseComments = '';
    comp.licenseInfoFromFiles = [lic];
  }
  if (!comp.downloadLocation) {
    comp.downloadLocation = repoUrl || 'http://spdx.org/rdf/terms#noassertion';
  }
  if (homepageUrl) {
    comp.homepage = homepageUrl;
  }
  return comp;
}

function handleDependency(list, dependency, type, relationships, parent, rootList, variant, cryptoProperties) {
  let component;
  if (type === 'cydx') {
    component = dependencyToCydxComponent(dependency);
  } else if (type === 'spdx') {
    let listItem = rootList ? rootList.find((item)=>{
      return dependency.key === item.key
    }) : null
    component = dependencyToSpdxComponent(dependency, listItem);
  } else {
    component = dependency;
  }
  if (component) {
    const hasComponent = list.find((item) => (item.SPDXID && item.SPDXID === component.SPDXID)
      || (item['bom-ref'] && item['bom-ref'] === component['bom-ref']));
    if (!hasComponent && ((type === 'cydx' && component['bom-ref'] && (!variant || variant === 'SBOM')) || type === 'spdx')){
      list.push(component);
    }else if (hasComponent && type === 'spdx'){
      component.SPDXID = component.SPDXID + '-' + uuid.v4()
      list.push(component);
    }
  }
  if (relationships && parent && (!variant || variant === 'SBOM')) {
    if (type === 'cydx') {
      const hasComponent = relationships.find((item) => {
        return item.ref === parent['bom-ref'] && item.dependsOn[0] === component['bom-ref']
      });
      if(!hasComponent){
        relationships.push({
          ref: parent['bom-ref'],
          dependsOn: [
            component['bom-ref']
          ]
        });
      }
    } else if (type === 'spdx') {
      if (parent.creationInfo) {
        relationships.push({
          spdxElementId: parent.SPDXID,
          relatedSpdxElement: component.SPDXID,
          relationshipType: 'DESCRIBES'
        });
      }
      const hasComponent = relationships.find((item) => {
        return item.spdxElementId === parent.SPDXID && item.relatedSpdxElement === component.SPDXID
      });
      if(!hasComponent) {
        relationships.push({
          spdxElementId: parent.SPDXID,
          relatedSpdxElement: component.SPDXID,
          relationshipType: 'CONTAINS'
        });
      }
    }
  }
  if(dependency.crypto_algorithms && type === 'cydx' && (!variant || variant === 'CBOM')){
    dependency.crypto_algorithms.forEach(algorithm => {
      const algorithmAvailable = _.some(list,(comp)=>{
        if(!comp.name || !algorithm.algorithm){
          return false;
        }
        return comp.name.toLowerCase() === algorithm.algorithm.toLowerCase();
      })
      let details = cryptoProperties && cryptoProperties[dependency.moduleId] && cryptoProperties[dependency.moduleId].filter((item)=>{
        if(!item.name || !algorithm.algorithm){
          return false;
        }
        return item.name.toLowerCase() === algorithm.algorithm.toLowerCase();
      }) || []
      let projectDetails = cryptoProperties && cryptoProperties['project'] && cryptoProperties['project'].filter((item)=>{
        if(!item.name || !algorithm.algorithm){
          return false;
        }
        return item.name.toLowerCase() === algorithm.algorithm.toLowerCase();
      }) || []
      details = details.concat(projectDetails)
      if(details && details.length > 0){
        let detailsByModule = details.find(item=>{
          return item.moduleId
        })
        if(detailsByModule){
          details = [detailsByModule]
        }else{
          let detailsByProject = details.find(item=>{
            return item.projectId
          })
          if(detailsByProject){
            details = [detailsByProject]
          }
        }
      }
      if(!algorithmAvailable) {
        list.push({
          type: 'cryptographic-asset',
          name: algorithm.algorithm,
          'bom-ref': algorithm.algorithm,
          cryptoProperties: {
            assetType: 'algorithm',
            algorithmProperties: details && details[0] && details[0].algorithmProperties
          }
        })
      }
      if(relationships){
        const hasComponent = relationships.find((item) => {
          return item.ref === parent['bom-ref'] && item.dependsOn[0] === component['bom-ref']
        });
        if(hasComponent){
          if(!hasComponent.provides){
            hasComponent.provides = []
          }
          if(hasComponent.provides.indexOf(algorithm) === -1){
            hasComponent.provides.push(algorithm)
          }
        }
      }
    })
  }
  if (dependency.dependencies) {
    dependency.dependencies.forEach((child) => {
      handleDependency(list, child, type, relationships, component, rootList, variant, cryptoProperties);
    });
  }
}
