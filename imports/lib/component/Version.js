import _ from 'underscore';
import License from './License';
import Checksum from './Checksum';
import QOS from './QOS';
import {Config} from '/imports/config';

/**
 * Constructor
 * doc: the data object where all methods work on
 */
const Version = function (doc, component, index) {
  this.data = function () {
    return doc;
  };
  this.component = component;
  if (index != undefined) {
    this.index = index;
  }
};

export default Version;

Version.prototype.changed = function changed() {
  this.component.changed();
};

Version.prototype.getVersion = function getVersion() {
  return this.data().version;
};

Version.prototype.getPackageUrl = function getPackageUrl() {
  return this.data().purl;
};

Version.prototype.setPackageUrl = function setPackageUrl(url) {
  if (url && (url !== this.data().purl)) {
    this.data().purl = url;
    this.changed();
  }
};

Version.prototype.setToBeResearched = function setToBeResearched(value) {
  let data = this.data();
  if (value && data.toBeResearched !== value) {
    this.data().toBeResearched = value;
  }
};

Version.prototype.getReleaseDate = function getReleaseDate() {
  let date = this.data().releaseDate;
  if (!date) {
    let key = this.component.getKey();
    if (key.indexOf('mvn') === 0 || key.indexOf('maven') === 0) {
      let mvnCentralRelInfo = this.component.getCrawlerInfo('mavencentral-releases');
      if (mvnCentralRelInfo) {
        let mvnKey = key.substring(4) + ':' + this.getVersion();
        if (mvnCentralRelInfo.info && mvnCentralRelInfo.info.response && mvnCentralRelInfo.info.response.docs) {
          let mvnRel = _.findWhere(mvnCentralRelInfo.info.response.docs, {id: mvnKey});
          if (mvnRel) {
            date = new Date(mvnRel.timestamp);
          }
        }
      }
    }
  }
  return date;
};

Version.prototype.setReleaseDate = function setReleaseDate(date) {
  if (date) {
    if (date instanceof Date === false) {
      date = new Date(date);
    }
    if (date !== this.data().releaseDate) {
      this.data().releaseDate = date;
      this.changed();
    }
  }
};

Version.prototype.setCopyright = function setCopyright(text) {
  if (text) {
    if (text !== this.data().copyright) {
      this.data().copyright = text;
      this.changed();
    }
  }else{
    this.data().copyright = null;
    this.changed();
  }
};

Version.prototype.getVulnerabilities = function () {
  let self = this
  if(this.component && this.component.data().problems && this.component.data().problems.vulnerability) {
    return this.component.data().problems.vulnerability.filter(vulnerability => {
      return !vulnerability.version || vulnerability.version === self.getVersion();
    }).map(vln =>{
      return {
        url: Config.appUrl + 'vulnerability_lake',
        bump_hints: vln.extra.bump_hints,
        confidence: vln.extra.confidence || 'HIGH',
        vendor: vln.extra.vendor || null,
        product: vln.extra.product || null,
        type: 'ts-vl',
        cwe: true,
        cvssScore: vln.extra.score,
        baseScore: vln.extra.score,
        vectorString: vln.extra.vector,
        name: vln.message,
        cisa: vln.extra.cisa,
        status: vln.status
      };
    })
  }
  return this.data().vulnerabilities || [];
};

Version.prototype.getVulnerabilitiesSorted = function () {
  let list = this.data().vulnerabilities;
  return list && _.sortBy(list, function (vulnerability) {
    const scorePrefix = parseFloat(vulnerability.score) !== 10.0 ? '0' + vulnerability.score : vulnerability.score;
    return (!isNaN(vulnerability.score) ? scorePrefix
      : '00.0') + (vulnerability.severity || '')
  }).reverse() || [];
};

/** **************************************
 *  Relations management starts from here
 */

/**
 *  Licenses
 */

Version.prototype.findLicense = function findLicense(licKey) {
  if (this.data().licenses) {
    const lic = _.findWhere(this.data().licenses, {key: licKey});
    return lic ? new License(lic, this) : undefined;
  }
  return undefined;
};

function _getLicense(match) {
  if (!this.data().licenses) {
    this.data().licenses = [];
  }
  let license = _.findWhere(this.data().licenses, match);
  if (license === undefined) {
    license = match;
    this.data().licenses.push(license);
    this.changed();
  }
  return new License(license, this);
}
Version.prototype.getLicense = function getLicense(licKey) {
  return _getLicense.call(this, {key: licKey});
};
Version.prototype.getLicenseByName = function getLicense(licName) {
  return _getLicense.call(this, {name: licName});
};
Version.prototype.removeLicense = function removeLicense(index) {
  const licenses = this.data().licenses || [];

  if (index >= 0 && index < licenses.length) {
    licenses.splice(index, 1);
    this.changed();
  }
};

Version.prototype.hasValidatedLicense = function () {
  const licenses = this.data().licenses;
  if (licenses) {
    for (let i = 0; i < licenses.length; i++) {
      if (new License(licenses[i], this).isValid()) {
        return true;
      }
    }
  }
  return false;
};
Version.prototype.hasInvalidValidatedLicense = function () {
  let self = this;
  let licenses = this.data().licenses
  return !licenses || (licenses && !licenses.length) || _.some(licenses, function (obj) {
    let license = new License(obj, self)
    return !license.isValid()
  });
};

Version.prototype.getLicenses = function getLicenses(declaredLicenses) {
  let licenses = [];
  const self = this;
  let index = 0;
  if(self.data().licenses && self.data().licenses.length > 0 || (declaredLicenses && declaredLicenses.length > 0)){
    const fallbackLicenses = declaredLicenses && declaredLicenses.length > 0 ? declaredLicenses : [];
    let allLicenses = self.data().licenses && self.data().licenses.length > 0 ? self.data().licenses : fallbackLicenses
    // skip unmatched licenses if valid one available
    const tmpListLicenses = allLicenses.filter((license)=>{
      return license.key
    })
    if(tmpListLicenses.length > 0){
      allLicenses = tmpListLicenses
    }
    allLicenses.forEach(function (l) {
      if(index === 0){
        l.selected = true
      }
      licenses.push(new License(l, self, index++));
    });
    licenses = _.sortBy(licenses,function (license) {
      return license.getKey()
    });
  }
  return licenses;
};

Version.prototype.getLicensesClean = function getLicensesClean() {
  let licenses = [];
  const self = this;
  let index = 0;
  if(self.data().licenses && self.data().licenses.length > 0){
    let allLicenses = self.data().licenses && self.data().licenses.length > 0 ? self.data().licenses : []
    allLicenses.forEach(function (l) {
      if(index === 0){
        l.selected = true
      }
      licenses.push(new License(l, self, index++));
    });
    licenses = _.sortBy(licenses,function (license) {
      return license.getKey()
    });
  }
  return licenses;
};

Version.prototype.getCopyright = function getCopyright() {
  return this.data().copyright;
};

/**
 *  Checksums
 */
function _findChecksum(algo) {
  if (this.data().checksums && algo) {
    const algoEnd = algo.indexOf(':');
    if (algoEnd >= 0) {
      algo = algo.substring(0, algoEnd);
    }
    return _.find(this.data().checksums, function (chk) {
      return chk.checksum.indexOf(algo) === 0 && chk.checksum.charAt(algo.length) === ':';
    });
  }
  return undefined;
}
Version.prototype.findChecksum = function findChecksum(algo) {
  const checksum = _findChecksum.call(this, algo);
  return checksum ? new Checksum(checksum, this) : undefined;
};

Version.prototype.getChecksum = function getChecksum(checksum) {
  if (!this.data().checksums) {
    this.data().checksums = [];
  }
  const pattern = {checksum: checksum};
  let check = _.findWhere(this.data().checksums, pattern);
  if (!check) {
    check = pattern;
    this.data().checksums.push(check);
  }
  return new Checksum(check, this);
};

Version.prototype.getChecksums = function getChecksums() {

  let checksums = [];
  const self = this;
  let index = 0;

  (self.data().checksums || []).forEach(function (chk) {
    checksums.push(new Checksum(chk, self, index++));
  });
  return checksums;
};

Version.prototype.validateChecksum = function checksumValid(algoAndChecksum) {
  const checksum = this.findChecksum(algoAndChecksum);
  const result = {valid: null};
  if (checksum) {
    result.expected = checksum.getChecksum();
    const qos = checksum.getQos();
    if (qos === QOS.REPO_CRAWLER || qos === QOS.HUMAN) {
      result.valid = checksum.getChecksum() === algoAndChecksum;
    }
  }
  return result;
};

