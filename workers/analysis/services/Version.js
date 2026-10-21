import _ from 'underscore';
import { Module } from './Module.js';
import { QOS } from './QOS.js';

const Version = {};

function isLicenseSelected(module, component, version, path, selectedLicense) {
  return module && Module.isLicenseSelected &&
    Module.isLicenseSelected(module, component, version, path, selectedLicense);
}

Version.getLicenses = function getLicenses(version, declaredLicenses, module, componentKey) {
  let licenses = [];
  let selected ;
  if(version.licenses && version.licenses.length > 0 || (declaredLicenses && declaredLicenses.length > 0)){
    let allLicenses;
    if(version.licenses && version.licenses.length > 0){
      allLicenses = version.licenses
    }else{
      allLicenses = declaredLicenses && declaredLicenses.length > 0 ? declaredLicenses : []
    }
    allLicenses.forEach(function (l) {
      l.selected = !!isLicenseSelected(module, componentKey, '*', null, (l.key || l.name))
      if(l.selected){
        selected = (l.key || l.name)
      }
      licenses.push(l);
    });
    licenses = _.sortBy(licenses,function (license) {
      return license.key
    });
  }
  licenses = licenses.filter((i)=>i.key || i.name)
  if(!selected && licenses.length){
    licenses[0].selected = true
  }
  return licenses;
};

Version.findChecksum = function findChecksum(version, algo) {
  if (version.checksums && algo) {
    const algoEnd = algo.indexOf(':');
    if (algoEnd >= 0) {
      algo = algo.substring(0, algoEnd);
    }
    return _.find(version.checksums, function (chk) {
      return chk.checksum.indexOf(algo) === 0 && chk.checksum.charAt(algo.length) === ':';
    });
  }
  return undefined;
};

Version.validateChecksum = function checksumValid(version, algoAndChecksum) {
  const checksum = Version.findChecksum(version, algoAndChecksum);
  const result = {valid: null};
  if (checksum) {
    result.expected = checksum.checksum;
    const qos = checksum.qos;
    if (qos === QOS.REPO_CRAWLER || qos === QOS.HUMAN) {
      result.valid = checksum.checksum === algoAndChecksum;
    }
  }
  return result;
};

export {
  Version
};

