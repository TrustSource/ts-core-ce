import QOS from './QOS.js';

const License = function (doc, version, index) {
  this.data = function () {
    return doc;
  };
  this.version = version;
  if (index != undefined) {
    this.index = index;
  }
};

export default License;

License.prototype.setQos = function setQos(qos) {

  if (qos instanceof QOS === false) {
    qos = new QOS(qos);
  }

  if (this.data().qos !== qos.getAsNum()) {
    this.data().qos = qos.getAsNum();
    this.version.changed();
  }
};

License.prototype.getQos = function getQos() {
  return new QOS(this.data().qos, QOS.REPO_CRAWLER).getAsNum();
};

License.prototype.getQosStr = function getQosStr() {
  return new QOS(this.data().qos, QOS.REPO_CRAWLER).getAsStr();
};

License.prototype.isValid = function isValid() {
  const qos = this.data().qos;
  return qos !== undefined && new QOS(qos).isIn([QOS.PACKAGE_META, QOS.REPO_CRAWLER, QOS.HUMAN]);
};

License.prototype.getKey = function getKey() {
  return this.data() && this.data().key;
};

License.prototype.getStatus = function getStatus() {
  return this.data() && this.data().status || 'warnings';
};

License.prototype.isSelected = function getStatus() {
  return this.data() && this.data().selected || false;
};

License.prototype.setSelected = function getStatus() {
  this.version.changed();
  this.data().selected = true;
};

License.prototype.setKey = function setKey(key) {
  if (key && this.data().key !== key) {
    this.data().key = key;
    this.version.changed();
  }
};
License.prototype.getName = function getName() {
  return this.data().name || this.data().key;
};

License.prototype.setName = function setName(name) {
  if (name !== this.data().name) {
    this.data().name = name;
    this.version.changed();
  }
};

License.prototype.getUrl = function getUrl() {
  return this.data().url;
};

License.prototype.isUnknown = function getUrl() {
  const status = this.data().rawStatus === 'UNKNOWN';
  return status && 'The license identifier is unknown and its legal status is unclear. ' +
    'Please contact the developer for further information.';
};

License.prototype.isCommercial = function isCommercial() {
  return this.getKey() === 'COMMERCIAL';
};

License.prototype.setUrl = function setUrl(url) {
  const data = this.data();
  if (url && url !== data.url) {
    data.url = url;
    this.version.changed();
  } else if (!url && data.url) {
    delete data.url;
    this.version.changed();
  }
};

License.prototype.getText = function getKey() {
  return this.data().text || '';
};
