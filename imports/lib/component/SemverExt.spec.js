
import SemverExt from './SemverExt';
import {expect} from 'chai';

const V1 = '1.0.1-SNAPSHOT'
const WRONG_PROPERTY = 'wrong property'

describe('Semver extension SemverExt', function () {
  describe('SemverExt.isValid()', function () {
    it('should return true if version is valid', function () {
      expect(SemverExt.isValid('1.1.1')).to.be.true;
    });
    it('should return false if version is invalid', function () {
      expect(SemverExt.isValid('1.x')).to.be.false;
    });
  });

  describe('SemverExt.compare()', function () {
    it('should compare with strict checking', function () {
      expect(SemverExt.compare('2.0', '1.1.1')).to.be.equal(-1);
    });
    it('should compare with lenient checking', function () {
      expect(SemverExt.compare('2.0', '1.1.1', true)).to.be.equal(1);
    });
  });

  describe('SemverExt.arraySortByVersion()', function () {
    it('should sort array objects with of versions in ascending order', function () {

      const versions = [{version: '1.0.2'}, {version: 'A'}, {version: V1},
        {version: 'B'}, {versions: WRONG_PROPERTY}, {version: '1'}, {version: '2'},
        {version: '1.0'}, {version: '1.0.1'}];

      const result = SemverExt.arraySortByVersion(versions);

      expect(result).to.be.deep.equal([{versions: WRONG_PROPERTY},
        {version: 'A'}, {version: 'B'}, {version: '1'}, {version: '1.0'},
        {version: V1}, {version: '1.0.1'}, {version: '1.0.2'}, {version: '2'}]);

    });

    it('should sort array of objects with versions in named attribute in ascending order', function () {
      const versions = [{v: '2.0'}, {v: '1.0'}];
      expect(SemverExt.arraySortByVersion(versions, 'v')).to.be.deep.equal([{v: '1.0'}, {v: '2.0'}]);
    });
  });

  describe('SemverExt.arraySortByVersionDesc()', function () {
    it('should sort array of versions in descending order', function () {
      const versions = [{version: '1.0.2'}, {version: 'A'}, {version: V1}, {version: 'B'},
        {versions: WRONG_PROPERTY}, {version: '1'}, {version: '2'}, {version: '1.0'}, {version: '1.0.1'}];

      const result = SemverExt.arraySortByVersionDesc(versions);

      expect(result).to.be.deep.equal([{version: '2'}, {version: '1.0.2'}, {version: '1.0.1'},
        {version: V1}, {version: '1'},
        {version: '1.0'}, {version: 'B'}, {version: 'A'},
        {versions: WRONG_PROPERTY}]);
    });

    it('should sort array of objects with versions in named attribute in descending order', function () {
      const versions = [{V: '1.1'}, {V: '1'}, {V: '2'}];
      expect(SemverExt.arraySortByVersionDesc(versions, 'V')).to.be.deep.equal([{V: '2'}, {V: '1.1'}, {V: '1'}]);
    });
  });
});
