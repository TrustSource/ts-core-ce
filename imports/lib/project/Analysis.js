import _ from 'underscore';

const Analysis = function (doc) {
  _.extend(this, doc);
};

export default Analysis;

Analysis.prototype.getTotalLicenseCnt = function () {
  const self = this;
  const count = self.licenses && self.licenses.length || 0;
  if (count > 0) {
    // check is unknown license in array
    return _.findWhere(self.licenses, {name: 'unknown'}) ? count - 1 : count;
  }
  return count;
};

Analysis.prototype.getLicensesComponentsCnt = function () {
  const result = {};
  if (this.licenses) {
    this.licenses.forEach(l => {
      let components = _.uniq(l.components, function (comp){
        return comp.path + comp.componentKey + comp.version
      })
      result[l.key] = components.length;
    });
  }
  return result;
};

Analysis.prototype.getComponents = function () {
  return this.components;
};

Analysis.prototype.getTotalComponentCnt = function () {
  return this.components && this.components.length;
};

Analysis.prototype.getAllComponents = function () {
  return this.components;
};

Analysis.prototype.getLicenses = function () {
  return this.licenses || [];
};

Analysis.prototype.getLicenseRating = function (licenseKey) {
  let license;
  if (this.licenses) {
    license = _.findWhere(this.licenses, {key: licenseKey});
  }
  return license && license.rating;
};
