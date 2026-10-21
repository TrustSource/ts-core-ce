import _ from 'underscore';

let QOS = {};

QOS['enum'] = ['NOT_CHECKED', 'PACKAGE_META', 'REPO_CRAWLER', 'HUMAN', 'CLARIFICATION_NEEDED'];

QOS.NOT_CHECKED = QOS.enum.indexOf('NOT_CHECKED');
QOS.PACKAGE_META = QOS.enum.indexOf('PACKAGE_META');
QOS.REPO_CRAWLER = QOS.enum.indexOf('REPO_CRAWLER');
QOS.HUMAN = QOS.enum.indexOf('HUMAN');
QOS.CLARIFICATION_NEEDED = QOS.enum.indexOf('CLARIFICATION_NEEDED');

QOS.getAsNum = function () {
  return this.qos;
};
QOS.getAsStr = function () {
  return QOS.enum[this.qos];
};
QOS.indexOf = function (cmp) {
  if (cmp instanceof Array === false) {
    throw new TypeError('Array expected as argument');
  }

  cmp = _.map(cmp, function (c) {
    return c;
  });
  for (let i = 0; i < cmp.length; i++) {
    if (this.qos === cmp[i].qos) return i;
  }
  return -1;
};

QOS.isIn = function (cmp) {
  if (cmp instanceof Array === false) {
    cmp = [cmp];
  }
  return this.indexOf(cmp) >= 0;
};

export {
  QOS
};


