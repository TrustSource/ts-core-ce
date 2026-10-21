/* eslint-disable no-useless-escape */

import Utils from './utils.js';
import {expect} from 'chai';

describe('Utils', function () {

  describe('mapRange()', function () {
    it('should transform positive range', function () {
      expect(Utils.mapRange(5, 0, 10, 0, 100)).to.equal(50);
      expect(Utils.mapRange(16, 0, 20, 1, 5)).to.equal(4);

    });
    it('should transform negative range', function () {
      expect(Utils.mapRange(5, 0, 10, -100, 0)).to.equal(-50);
      expect(Utils.mapRange(-16, -20, -10, 0, 5)).to.equal(2);
    });
  });

  describe('mongoPath', function () {

    it('should replace all $ with arguments in order of appearance', function () {

      expect(Utils.mongoPath('a.$.bc.$.efg.$.z', 3, 2)).to.be.equal('a.3.bc.2.efg.$.z');
    });
  });

  describe('format', function () {

    it('should replace all {\d} with positional arguments', function () {

      expect(Utils.format('Third: {2}, Second: {1}, First: {0}, Nonexisting: {3}, firstAgain: {0}',
        'first', 'second', 'third')).to.be.equal('Third: third, Second: second, First: first, Nonexisting: {3}, firstAgain: first');
    });
  });

  describe('ComponentKey', function () {
    it('should parse full qualified comp-identifier in 3 parts', function () {
      const result = new Utils.ComponentKey('mvn:commons-codec:commons-codec:1.3.3');
      expect(result.manager).to.equals('mvn');
      expect(result.component).to.equals('commons-codec:commons-codec');
      expect(result.version).to.equals('1.3.3');
    });

    it('should parse full qualified comp-identifier in 2 parts', function () {
      const result = new Utils.ComponentKey('mvn:commons-codec:commons-codec:1.3.3', {
        component: true,
        version: true
      });
      expect(result.manager).to.be.undefined;
      expect(result.component).to.equals('mvn:commons-codec:commons-codec');
      expect(result.version).to.equals('1.3.3');
    });
  });

  describe('Rating', function () {

    it('getState() should convert Ratings to states', function () {

      expect(function () {
        Utils.Rating.getState('abc');
      }).to.throw(Error, /number required as rating/);
      expect(Utils.Rating.getState(0)).to.be.equal('violations');
      expect(Utils.Rating.getState(3)).to.be.equal('warnings');
      expect(Utils.Rating.getState(7)).to.be.equal('ok');
    });
  });

  describe('ComponentRegExp', function () {

    it('should throw TypeError if a non-string/non-regexp is passed', function () {
      expect(function () {
        new Utils.ComponentRegExp(123);
      }).to.throw(TypeError);
    });

    it('should escape regex metacharacters instead of throwing (issue #49)', function () {
      const re = new Utils.ComponentRegExp('apk:alpine:libstdc++' + '$');
      expect(re instanceof RegExp).to.be.true;
      expect('apk:alpine:libstdc++'.match(re)).not.to.be.null;
      expect('apk:alpine:libstdc'.match(re)).to.be.null;
    });

    it('should return RegExp Object if valid expression is passed', function () {
      expect(new Utils.ComponentRegExp('mvn:javax.ws.rs:javax.ws.rs-api') instanceof RegExp).to.be.equal(true);
    });

    it('should escape dots and convert * to .*', function () {
      expect(new Utils.ComponentRegExp('mvn:123:*')).to.be.deep.equal(/mvn:123:.*/);
      expect(new Utils.ComponentRegExp('...:**')).to.be.deep.equal(/\.\.\.:.*.*/);
    });

    describe('check() function', function () {
      it('should return true for valid expressions', function () {
        expect(Utils.ComponentRegExp.check('mvn:javax.ws.rs:javax.ws.rs-api')).to.be.true;
      });

    });

    describe('ComponentRegExp.KEY', function () {
      it('should not match valid expressions', function () {
        expect(Utils.ComponentRegExp.KEY.test('npm:*d:456')).to.be.false;
        expect(Utils.ComponentRegExp.KEY.test('*:group:arti**')).to.be.false;
        expect(Utils.ComponentRegExp.KEY.test('npmx:ab')).to.be.false;
        expect(Utils.ComponentRegExp.KEY.test('*:a:b:c')).to.be.false;
      });

      it('should match valid expressions', function () {
        expect(Utils.ComponentRegExp.KEY.test('mvn:123:*')).to.be.true;
        expect(Utils.ComponentRegExp.KEY.test('bower:myown*')).to.be.true;
        expect(Utils.ComponentRegExp.KEY.test('npm:group:345')).to.be.true;
        expect(Utils.ComponentRegExp.KEY.test('*:fu_ll.qu-all:arti*')).to.be.true;
        expect(Utils.ComponentRegExp.KEY.test('*:abc')).to.be.true;
      });

      it('a valid regexp should match matching keys', function () {
        const regexp = new Utils.ComponentRegExp('*:123:*');
        expect('mvn:123:456'.match(regexp)).not.to.be.null;
        expect('bower:123:2'.match(regexp)).not.to.be.null;
      });

      it('a valid regexp should not match nonmatching keys', function () {
        const regexp = new Utils.ComponentRegExp('*:123:*');
        expect('mvn:1234:456'.match(regexp)).to.be.null;
        expect('bower:12:2'.match(regexp)).to.be.null;
      });
    });

    describe('ComponentRegExp.VERSION', function () {
      it('should not match valid expressions', function () {
        expect(Utils.ComponentRegExp.VERSION.test('*.0')).to.be.false;
        expect(Utils.ComponentRegExp.VERSION.test('1.*.0')).to.be.false;
      });

      it('should match valid expressions', function () {
        expect(Utils.ComponentRegExp.VERSION.test('1.0.0')).to.be.true;
        expect(Utils.ComponentRegExp.VERSION.test('1.0.*')).to.be.true;
        expect(Utils.ComponentRegExp.VERSION.test('1*')).to.be.true;
        expect(Utils.ComponentRegExp.VERSION.test('*')).to.be.true;
      });

      it('a valid regexp should match matching versions', function () {
        const regexp = new Utils.ComponentRegExp('1.*');
        expect('1.2'.match(regexp)).not.to.be.null;
        expect('1.2.3'.match(regexp)).not.to.be.null;
      });

      it('a valid regexp should not match nonmatching versions', function () {
        const regexp = new Utils.ComponentRegExp('1.*');
        expect('2.0'.match(regexp)).to.be.null;
        expect('10.0'.match(regexp)).to.be.null;
      });
    });
  });
});
