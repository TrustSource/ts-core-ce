import _ from 'underscore';

const QOS = function QOS(qos, _default) {
  const qosNum = _.isNumber(qos) ? qos : QOS[qos];
  if (qosNum === undefined || qosNum < 0 || qosNum >= QOS['enum'].length) {
    if (_default === undefined) {
      throw new TypeError('undefined value for QOS("' + qos + '")');
    } else {
      return new QOS(_default);
    }
  }
  this.qos = qosNum;
};

export default QOS;

QOS['enum'] = ['NOT_CHECKED', 'PACKAGE_META', 'REPO_CRAWLER', 'HUMAN', 'CLARIFICATION_NEEDED'];

QOS.NOT_CHECKED = QOS.enum.indexOf('NOT_CHECKED');
QOS.PACKAGE_META = QOS.enum.indexOf('PACKAGE_META');
QOS.REPO_CRAWLER = QOS.enum.indexOf('REPO_CRAWLER');
QOS.HUMAN = QOS.enum.indexOf('HUMAN');
QOS.CLARIFICATION_NEEDED = QOS.enum.indexOf('CLARIFICATION_NEEDED');

QOS.prototype.getAsNum = function () {
  return this.qos;
};
QOS.prototype.getAsStr = function () {
  return QOS.enum[this.qos];
};
QOS.prototype.indexOf = function (cmp) {
  if (cmp instanceof Array === false) {
    throw new TypeError('Array expected as argument');
  }

  cmp = _.map(cmp, function (c) {
    return c instanceof QOS ? c : new QOS(c);
  });
  for (let i = 0; i < cmp.length; i++) {
    if (this.qos === cmp[i].qos) return i;
  }
  return -1;
};

QOS.prototype.isIn = function (cmp) {
  if (cmp instanceof Array === false) {
    cmp = [cmp];
  }
  return this.indexOf(cmp) >= 0;
};

