import _ from 'underscore';

const CompanyStats = function (company, doc) {
  _.extend(this, doc);
  this.company = company;
};

CompanyStats.prototype.getModuleSummary = function () {
  const stats = _.clone(this);
  ['modules', 'components', 'licenses'].forEach(k => {
    let r = stats[k];
    r.ok = Math.max(0, r.total - r.warnings - r.violations);
    r.okPercent = (r.ok * 100) / r.total;
    r.warningsPercent = (r.warnings * 100) / r.total;
    r.violationsPercent = (r.violations * 100) / r.total;
  });
  return stats;
};

export default CompanyStats;
