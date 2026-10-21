import _ from 'underscore';

const Approve = function (data) {
  _.extend(this, data);
};

export default Approve;

Approve.prototype.getData = function () {
  return this.data
};
