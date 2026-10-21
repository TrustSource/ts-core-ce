import QOS from './QOS';

const Checksum = function (doc, version, index) {
  this.data = function () {
    return doc;
  };
  this.version = version;
  if (index !== undefined) {
    this.index = index;
  }
};

export default Checksum;

Checksum.prototype.getChecksum = function getChecksum() {
  return this.data().checksum;
};

Checksum.prototype.setQos = function setQos(qos) {

  if (qos instanceof QOS === false) {
    qos = new QOS(qos);
  }

  if (this.data().qos !== qos.getAsNum()) {
    this.data().qos = qos.getAsNum();
    this.version.changed();
  }
};

Checksum.prototype.getQos = function getQos() {
  return new QOS(this.data().qos, QOS.REPO_CRAWLER).getAsNum();
};

Checksum.prototype.getQosStr = function getQosStr() {
  return new QOS(this.data().qos, QOS.REPO_CRAWLER).getAsStr();
};

Checksum.prototype.setChecksum = function setChecksum(checksum) {
  if (checksum && checksum !== this.data().checksum) {
    this.data().checksum = checksum;
    this.version.changed();
  }
};

Checksum.prototype.getChecksum = function getChecksum() {
  return this.data().checksum;
};
