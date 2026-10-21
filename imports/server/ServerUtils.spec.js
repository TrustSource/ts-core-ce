
import Utils from './ServerUtils.js';
import {expect} from 'chai';

const MVN_SLIDER =  'mvn:de.eacg:ecs-mvn-plugin-slider';

describe('ServerUtils', function () {

  describe('stringAsUnicodeEsc()', function () {

    it('should convert string to its unicode respresentation', function () {
      expect(Utils.stringAsUnicodeEsc('ABC')).to.equal('\\u0041\\u0042\\u0043');
    });
  });

  describe('removeVT100Esc()', function () {

    const line = '\x1b[32minfo\x1b[39m: Logging started';
    const expected = 'info: Logging started';

    it('should remove all terminal escape sequences', function () {
      const converted = Utils.removeVT100Esc(line);
      expect(converted).to.equal(expected);
    });
  });

  describe('pick()', function () {
    it('should filter with predicate function', function () {
      const obj = {name: 'karl', key: '123', _id: 1234, __intern: 'hidden'};

      const newObj = Utils.pick(obj, function (value, key) {
        return key.indexOf('__') !== 0;
      });
      expect(newObj).to.deep.equal({name: 'karl', _id: 1234, key: '123'});
    });

    it('should filter with key-names', function () {
      const obj = {name: 'karl', key: '123', _id: 1234, __intern: 'hidden'};
      const newObj = Utils.pick(obj, 'name', 'key', '_id');

      expect(newObj).to.deep.equal({name: 'karl', _id: 1234, key: '123'});
    });
  });

  describe('ComponentKey()', function () {
    it('should parse keys with 3 parts', function () {
      const parsed = new Utils.ComponentKey('bower:angular-bootstrap-slider:0.1.3');
      expect(parsed.manager).to.equal('bower');
      expect(parsed.component).to.equal('angular-bootstrap-slider');
      expect(parsed.version).to.equal('0.1.3');
    });
    it('should parse keys with 4 parts', function () {
      const parsed = new Utils.ComponentKey('mvn:de.eacg:ecs-mvn-plugin-slider:0.1');
      expect(parsed.manager).to.equal('mvn');
      expect(parsed.component).to.equal('de.eacg:ecs-mvn-plugin-slider');
      expect(parsed.version).to.equal('0.1');
    });
    it('should assemble the component key', function () {
      const parsed = new Utils.ComponentKey('mvn:de.eacg:ecs-mvn-plugin-slider:0.1');
      expect(parsed.getKey()).to.equal(MVN_SLIDER);
    });

    it('should parse keys with 2 parts, without version', function () {
      const parsed = new Utils.ComponentKey('bower:angular-bootstrap-slider', {mgr: 1, component: 1});
      expect(parsed.manager).to.equal('bower');
      expect(parsed.component).to.equal('angular-bootstrap-slider');
      expect(parsed.version).to.equal(undefined);
    });
    it('should parse keys with 3 parts, without version', function () {
      const parsed = new Utils.ComponentKey(MVN_SLIDER, {mgr: 1, component: 1});
      expect(parsed.manager).to.equal('mvn');
      expect(parsed.component).to.equal('de.eacg:ecs-mvn-plugin-slider');
      expect(parsed.version).to.equal(undefined);
    });
    it('should assemble the component key', function () {
      const parsed = new Utils.ComponentKey(MVN_SLIDER, {mgr: 1, component: 1});
      expect(parsed.getKey()).to.equal(MVN_SLIDER);
    });

  });

  describe('Rating', function () {

    it('getState() should convert Ratings to states', function () {

      expect(function () {
        Utils.Rating.getState('abc');
      }).to.throw(Error, /number required as rating/);
      expect(Utils.Rating.getState(0)).to.equal('violations');
      expect(Utils.Rating.getState(3)).to.equal('warnings');
      expect(Utils.Rating.getState(7)).to.equal('ok');
    });

    describe('scale() should scale Ratings', function () {

      it('should throw Error if invalid arguments are passed', function () {

        expect(function () {
          Utils.Rating.scale(null);
        }).to.throw(TypeError, /must be a number/);

        expect(function () {
          Utils.Rating.scale(1, null);
        }).to.throw(TypeError, /must be a number/);

        expect(function () {
          Utils.Rating.scale(1, -10, null);
        }).to.throw(TypeError, /must be a number/);
      });

      it('should scale a rating if correct range is passed', function () {
        expect(Utils.Rating.scale(50, 0, 100)).to.equal(3);
      });
    });
  });

  // #45: a key created without a scope used to pass every check.
  describe('validateKeyScope()', function () {
    it('refuses a missing key and a key without a scope', function () {
      expect(Utils.validateKeyScope(null, ['manager'])).to.equal(false);
      expect(Utils.validateKeyScope({}, ['manager'])).to.equal(false);
      expect(Utils.validateKeyScope({scope: null}, ['manager'])).to.equal(false);
      expect(Utils.validateKeyScope({scope: []}, ['manager'])).to.equal(false);
      expect(Utils.validateKeyScope({scope: 'manager'}, ['manager'])).to.equal(false);
      expect(Utils.validateKeyScope({}, [])).to.equal(false);
    });

    it('accepts a key whose scope shares a role with the endpoint', function () {
      expect(Utils.validateKeyScope({scope: ['developer', 'manager']}, ['manager'])).to.equal(true);
      expect(Utils.validateKeyScope({scope: ['developer']}, ['manager'])).to.equal(false);
    });

    it('accepts any scoped key on an endpoint without roles', function () {
      expect(Utils.validateKeyScope({scope: ['developer']}, [])).to.equal(true);
      expect(Utils.validateKeyScope({scope: ['developer']}, undefined)).to.equal(true);
    });
  });
});
