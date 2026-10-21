import _ from 'underscore';

const Statistics = function (doc) {
  _.extend(this, doc);
};

Statistics.prototype.getSummary = function () {
  return {
    components: this.components,
    licenses: this.licenses,
    warnings: this.legal.warnings + this.vulnerability.warnings + this.viability.warnings + this.integrity.warnings,
    violations: this.legal.violations + this.vulnerability.violations + this.viability.violations + this.integrity.warnings
  };
};

Statistics.prototype.getState = function () {
  const sum = this.getSummary();
  const warningOrOk = sum.warnings ? 'warnings' : 'ok';
  return sum.violations ? 'violations' : warningOrOk;
};

Statistics.prototype.getAll = function () {
  const result = {};
  ['legal', 'vulnerability', 'viability', 'versioning', 'integrity', 'overall', 'encryption'].forEach(k => {
    let r = _.clone(this[k]);
    if(r){
      r.total = this.components;
      r.ok = Math.max(0, r.total - r.warnings - r.violations);
      r.okPercent = (r.ok * 100) / r.total;
      r.warningsPercent = (r.warnings * 100) / r.total;
      r.violationsPercent = (r.violations * 100) / r.total;
      result[k] = r;
    }
  });
  return result;
};

export default Statistics;
