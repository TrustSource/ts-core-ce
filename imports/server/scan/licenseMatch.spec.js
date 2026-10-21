
import Licenses from '../../lib/collections/licenses';
import LicensesService from '/imports/api/licenses';
import {matchLicense, matchWellknownLicenseName} from './licenseMatch';
import {expect} from 'chai';
import testdata from './licenses.json';

const APACHE2 = 'Apache-2.0';
const BSD4 = 'BSD-4-Clause';
const debug = false;

const log = debug ? console.log : function () {};

describe('matchLicense()', function () {

  // matchLicense reads the in-memory LicensesService list, so the test licenses are
  // written to the collection and the list is reloaded; the collection the app seeded
  // at startup is restored afterwards so later specs see it unchanged.
  let seeded = [];

  before(async function () {
    seeded = await Licenses.find({}, {transform: null}).fetchAsync();
    await importTestdata();
    await LicensesService.init();
  });

  after(async function () {
    await Licenses.removeAsync({});
    for (const doc of seeded) {
      await Licenses.insertAsync(doc);
    }
    await LicensesService.init();
  });

  it('should be guaranteed that the license collection in jasmine database is initialized', async function () {
    expect(await Licenses.find().countAsync()).to.be.above(300);
  });

  it('should not match a unknown license name', function () {
    const result = matchLicense('whjdfskjhkjhkhjkhk');
    expect(result.matchKey).to.be.null;
  });

  it('should cleanup the license-name before phrase and textual search', function () {
    let result = matchLicense('    The   Blvathev  ?  after  the Version v2.0,   ?   v ');
    expect(result.query).to.be.equal('Blvathev after 2.0 v');

    result = matchLicense('  Apache2, 2');
    expect(result.query).to.be.equal('Apache2 2.0');
  });

  it('should match key', function () {
    const result = matchLicense('MIT');
    expect(result.query).to.be.equal('MIT');
    expect(result.matchKey).to.be.equal('MIT');
    expect(result.type).to.be.equal('key');
  });

  // The matcher resolves a license by exact key, name (case-insensitive) or alias.
  // Full-text and fuzzy name matching are switched off (see licenseMatch.js), so a
  // loose name is left unmatched instead of being guessed.
  it('should match alias', function () {
    const result = matchLicense('GNU General 3.0');
    expect(result.matchKey).to.be.equal('GPL-3.0');
    expect(result.type).to.be.equal('alias');
  });

  it('should match a license by its full name', function () {
    const result = matchLicense('BSD 3-clause Clear License');
    expect(result.matchKey).to.be.equal('BSD-3-Clause-Clear');
  });

  it('should match all given licenses by key, name or alias', function () {
    const matchingLicenses = [
      {match: 'Artistic-2.0', key: 'Artistic-2.0'},
      {match: APACHE2, key: APACHE2},
      {match: 'apache-2.0', key: APACHE2},
      {match: 'Apache 2.0', key: APACHE2},
      {match: 'ASL', key: APACHE2},
      {match: 'Apache 1.1', key: 'Apache-1.1'},
      {match: 'BSD', key: BSD4},
      {match: 'BSD-style', key: BSD4},
      {match: 'New BSD', key: 'BSD-3-Clause'},
      {match: 'GPL 2.0', key: 'GPL-2.0'},
      {match: 'GNU Lesser General 3.0', key: 'LGPL-3.0'},
      {match: 'ISC', key: 'ISC'},
      {match: 'MIT', key: 'MIT'},
      {match: 'WTFPL', key: 'WTFPL'},
      {match: 'MIT/X11', key: 'MIT'}
    ];

    matchingLicenses.forEach(function (license) {
      const result = matchLicense(license.match);
      log('Matching %s, expected: %s, actual: %s, result', license.match, license.key, result.matchKey, result);
      expect(result.matchKey, license.match).to.be.equal(license.key);
      expect(result.ambiguousKey).to.be.undefined;
    });
  });

  it('should not guess a license from a loose or ambiguous name', function () {
    ['Apache License', 'Apache Software License, Version 1.1', 'Eclipse Public License, Version 1.0',
      'GNU General Public License 3.0'].forEach(function (licenseName) {
      const result = matchLicense(licenseName);
      expect(result.matchKey, licenseName).to.be.null;
      expect(result.type).to.be.equal('text');
    });
  });
});

describe('matchWellknownLicenseName()', function () {

  it('should match well known jersey signatures', function () {
    expect(matchWellknownLicenseName('CDDL+GPL License')).to.be.deep.equal(['CDDL-1.1', 'GPL-2.0']);
    expect(matchWellknownLicenseName('CDDL or GPLv2')).to.be.deep.equal(['CDDL-1.1', 'GPL-2.0']);
  });
});

async function importTestdata() {
  for (let key in testdata) {
    await Licenses.upsertAsync({key: key}, {$set: {name: testdata[key]}});
  }

  await Licenses.updateAsync({}, {$unset: {aliases: ''}}, {multi: true});
  await Licenses.updateAsync({key: 'Apache-1.0'}, {$push: {aliases: {$each: ['ASL 1.0', 'Apache 1.0']}}});
  await Licenses.updateAsync({key: 'Apache-1.1'}, {$push: {aliases: {$each: ['ASL 1.1', 'Apache 1.1']}}});
  await Licenses.updateAsync({key: APACHE2}, {$push: {aliases: {$each: ['Apache2', 'ASL', 'ASL 2.0', 'Apache 2.0']}}});
  await Licenses.updateAsync({key: 'MIT'}, {$push: {aliases: {$each: ['MIT/X11']}}});
  await Licenses.updateAsync({key: 'GPL-1.0'}, {$push: {aliases: {$each: ['GPL 1.0']}}});
  await Licenses.updateAsync({key: 'GPL-2.0'}, {$push: {aliases: {$each: ['GPL 2.0', 'GNU General 2.0']}}});
  await Licenses.updateAsync({key: 'GPL-3.0'}, {$push: {aliases: {$each: ['GPL 3.0', 'GNU General 3.0']}}});
  await Licenses.updateAsync({key: 'LGPL-1.0'}, {$push: {aliases: {$each: ['GNU Lesser General 1.0']}}});
  await Licenses.updateAsync({key: 'LGPL-2.0'}, {$push: {aliases: {$each: ['GNU Lesser General 2.0']}}});
  await Licenses.updateAsync({key: 'LGPL-3.0'}, {$push: {aliases: {$each: ['GNU Lesser General 3.0']}}});
  await Licenses.updateAsync({key: 'BSD-3-Clause'}, {$push: {aliases: {$each: ['New BSD']}}});
  await Licenses.updateAsync({key: BSD4}, {$push: {aliases: {$each: ['BSD', 'BSD-style']}}});
  await Licenses.updateAsync({key: 'MPL-1.0'}, {$push: {aliases: {$each: ['MPL 1.0']}}});
  await Licenses.updateAsync({key: 'MPL-1.1'}, {$push: {aliases: {$each: ['MPL 1.1']}}});
  await Licenses.updateAsync({key: 'MPL-2.0'}, {$push: {aliases: {$each: ['MPL 2.0']}}});
}
