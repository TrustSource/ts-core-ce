import _ from 'underscore';

const SBOM = function (data) {
  _.extend(this, data);
};

export default SBOM;

SBOM.prototype.getData = function () {
  return this.data
};
