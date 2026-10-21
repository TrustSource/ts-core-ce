import Licenses from '/imports/lib/collections/licenses';
import Utils from '/imports/lib/utils';
import _ from 'underscore';
import searchRegExp from '/imports/lib/searchRegExp';
import {licenseProjection} from '/imports/lib/licenses/licenseFields';

// List rows never render a license text, and only catalog fields may leave the server.
const LIST_FIELDS = licenseProjection({withText: false});

const getTransform = function(transforms) {
  return function(l) {
    transforms.forEach((transform) => l = transform(l));
    return l;
  };
};

const getOptions = function(query, {topLicenses, ...options}) {
  const transform = getTransform([
    topLicenses && ((l) => {
      l.rate = Utils.formatPercent(topLicenses[l.key]);
      return l;
    })
  ].filter(transform => transform));
  return {
    sort: {name: 1},
    transform,
    ...options,
    // After the caller's options: `options` arrives from a DDP client, and a `fields`
    // of its own must not widen what is sent.
    fields: LIST_FIELDS
  };
};

const localSearch = async function ({query, skip, limit, topLicenses}) {
  let params = {};
  query && (params['$or'] = [{name: searchRegExp(query)}]);
  topLicenses && (params.key = {$in: Object.keys(topLicenses)});
  const licenses = Licenses.find(params, topLicenses ? getOptions(query, {topLicenses}) : {sort: {name: 1}, skip, limit, fields: LIST_FIELDS});
  let licensesArr = await licenses.fetchAsync();
  if (topLicenses) {
    licensesArr = _.sortBy(licensesArr, ({rate}) => parseInt(rate)).reverse();
    licensesArr = licensesArr.slice(skip, skip + limit);
  }
  return {
    keys: licensesArr.map(({key}) => key),
    list: licensesArr.length,
    total: await Licenses.find().countAsync()
  };
};

const search = async function (query, options) {
  options = {
    page: 1,
    pageSize: 10,
    ...options
  };
  options.pageSize = +options.pageSize;
  let topLicenses = null;
  if (options.topLicenses) {
    topLicenses = {};
    options.topLicenses.forEach(({key, rate}) => topLicenses[key] = rate);
  }
  const skip = (options.page - 1) * options.pageSize;
  const limit = options.pageSize;
  const {keys, list, total} = await localSearch({query, skip, limit, topLicenses});
  let licenses = await Licenses.find({key: {$in: keys}}, getOptions(query, {...options, topLicenses})).fetchAsync();
  if (topLicenses) {
    licenses = _.sortBy(licenses, ({rate}) => parseInt(rate)).reverse();
  }
  return {licenses, list, total};
};

export default search;
