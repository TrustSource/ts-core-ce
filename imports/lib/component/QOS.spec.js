
import QOS from './QOS';
import {expect} from 'chai';

describe('QOS', function () {

  describe('constructor', function () {

    it('should throw exception if called with invalid number', function () {
      expect(function () {
        new QOS(-1);
      }).to.throw(TypeError, 'undefined value for QOS("-1")');

      expect(function () {
        new QOS(5);
      }).to.throw(TypeError, 'undefined value for QOS("5")');
    });

    it('should throw exception if called with invalid string literal', function () {
      expect(function () {
        new QOS('');
      }).to.throw(TypeError, 'undefined value for QOS("")');
    });

    it('should throw exception if called with value and invalid default', function () {
      expect(function () {
        new QOS('', 'xxx');
      }).to.throw(TypeError, 'undefined value for QOS("xxx")');
    });

    it('should use default, if value is invalid', function () {
      expect(new QOS('', 2)).to.be.deep.equal(new QOS(2));
    });
  });

  describe('getters should get numbers and strings', function () {
    const HUMAN = new QOS(QOS.HUMAN);

    it('getAsNum should get number', function () {
      expect(HUMAN.getAsNum()).to.be.equal(3);
    });

    it('getAsStr should get number', function () {
      expect(HUMAN.getAsStr()).to.be.equal('HUMAN');
    });
  });

  describe('isIn()', function () {
    const HUMAN = new QOS(QOS.HUMAN);

    it('should throw exception if cmp argument is invalid', function () {
      expect(function () {
        HUMAN.isIn('unknown');
      }).to.throw(TypeError, 'undefined value for QOS("unknown")');

      expect(function () {
        HUMAN.isIn([0, 1, 25]);
      }).to.throw(TypeError, 'undefined value for QOS("25")');

    });

    it('should compare with single argument', function () {
      expect(HUMAN.isIn(QOS.HUMAN)).to.be.true;
      expect(HUMAN.isIn(QOS.REPO_CRAWLER)).to.be.false;
    });

    it('should compare with Array argument', function () {
      expect(HUMAN.isIn([QOS.REPO_CRAWLER, QOS.HUMAN])).to.be.true;
      expect(HUMAN.isIn([QOS.REPO_CRAWLER, QOS.CLARIFICATION_NEEDED])).to.be.false;
    });

    it('should compare if cmp argument is QOS with default', function () {
      expect(HUMAN.isIn(new QOS('unknown', QOS.HUMAN))).to.be.true;
    });

  });

  describe('indexOf()', function () {
    const HUMAN = new QOS(QOS.HUMAN);
    it('should throw exception if single argument provided', function () {
      expect(function () {
        HUMAN.indexOf(QOS.HUMAN);
      }).to.throw(TypeError, 'Array expected as argument');
    });

    it('should work with Array argument', function () {
      expect(HUMAN.indexOf([QOS.CLARIFICATION_NEEDED, QOS.PACKAGE_META, QOS.HUMAN])).to.be.equal(2);
      expect(HUMAN.indexOf([QOS.REPO_CRAWLER, QOS.CLARIFICATION_NEEDED])).to.be.equal(-1);
    });
  });
});
