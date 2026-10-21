import _ from 'underscore';
import LicensesService from '/imports/api/licenses';
// import {RawLicenses} from '/imports/server/collections/licenses';

export const matchWellknownLicenseName = function matchWellknownLicenseName(name) {

  const dictonary = {
    'CDDL+GPL License': ['CDDL-1.1', 'GPL-2.0'],  // glassfish jersey signature
    'CDDL or GPLv2': ['CDDL-1.1', 'GPL-2.0']    // glassfish jersey signature
  };

  return dictonary[name];
};

export const cleanupLicenseName = function cleanupLicenseName(query) {    // whole words to remove
  let res = query.replace(/[)(]/g, '');
  return res.trim();
}

function cleanupQuery(query) {
  const cleanWords = ['the', 'version', 'license', 'public', 'open', 'software'].join('|');     // whole words to remove
  const cleanChars = [',', '\\?'].join('|');                      // characters to remove
  // words separated by whitespace or beginning or end of line and chars to remove
  const regexp = new RegExp('(\\b(' + cleanWords + ')\\b|' + cleanChars + ')', 'gi');

  let res = query.replace(regexp, '');
  // eslint-disable-next-line no-useless-escape
  res = res.replace(/\sv(?=[\d,\.]+)/g, '');              // remove ' v' if followed by digit or .
  res = res.replace(/\s{2,}/g, ' ');                      // replace all occurrences of more than one whitespace by a blank
  res = res.replace(/\s\d(?=\s|$)/g, '$&.0');             // append .0 to single digit
  return res.trim();
}

// public available
export const matchLicense = function matchLicense(query, privateLicenses) {

  // remove all fill expressions from query
  const cleanQuery = cleanupQuery(query);
  const config = {
    minScore: cleanQuery.split(' ').length * 2,
    minDelta: 1.0
  };

  /* try exact key or clean alias match */
  if(privateLicenses && privateLicenses.length){
    let privateFounds = _.filter(privateLicenses, function (privateLicense) {
      return privateLicense.key === query
    });
    if(privateFounds.length){
      return createResult(privateFounds, 'key', cleanQuery, config)
    }
  }
  let res = LicensesService.filter(query);
  if (res && res.length === 1) {
    if (res[0].key === query) {
      return createResult(res, 'key', query);
    } else {
      return createResult(res, 'alias', query);
    }
  }
  // disable text search for now
  // res = rawFind(cleanQuery);  // next try full text search
  return createResult([], 'text', cleanQuery, config);
};

// disable text search for now
// function rawFind(search) {
//   return RawLicenses.find({'$text': {'$search': search}},
//     {
//       fields: {
//         $text: 1,
//         score: {$meta: 'textScore'}
//       },
//       sort: {
//         score: {$meta: 'textScore'}
//       },
//       limit: 2
//     });
// }

function createResult(data, type, query, config) {
  const result = {
    matchKey: data.length > 0 ? data[0].key : null,
    matchName: data.length > 0 ? data[0].name || data[0].key : null,
    score: data.length > 0 ? data[0].score : 0,
    score2nd: data.length > 1 ? data[1].score : 0,
    query: query,
    type: type
  };
  if (config) {
    result.minScore = config.minScore;
    result.minDelta = config.minDelta;
  }

  if (data.length > 1 && (result.score < config.minScore || (result.score - result.score2nd) < config.minDelta)) {
    result.ambiguousKey = data[1].key;
    result.ambiguousName = data[1].name;
  }
  return result;
}

