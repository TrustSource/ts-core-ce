import {expect} from 'chai';
import {modifierTouchesAccountStatus} from './accountStatus';

// Gap coverage for the pure predicate `modifierTouchesAccountStatus`.
// accountStatus.spec.js already covers: top-level $set, dotted accountClearing.score,
// accountStatusInfo, $unset, replacement doc, $rename source+target, $inc, unrelated
// modifiers, prefix false-positive (accountStatusExtra/accountClearingFoo), null/
// non-object. These cases were NOT covered there and exercise the remaining Mongo
// operators, deeper dotted paths, and the empty/array input edges.
describe('accountStatus gaps: modifierTouchesAccountStatus (#95)', function () {

  describe('additional write operators', function () {
    it('detects $setOnInsert of a locked field (upsert insert branch)', function () {
      expect(modifierTouchesAccountStatus({$setOnInsert: {accountStatus: 'suspended'}})).to.be.true;
    });

    it('detects $setOnInsert of a dotted locked sub-path', function () {
      expect(modifierTouchesAccountStatus({$setOnInsert: {'accountClearing.score': 1}})).to.be.true;
    });

    it('detects $push targeting a locked field', function () {
      expect(modifierTouchesAccountStatus({$push: {accountClearing: {score: 1}}})).to.be.true;
    });

    it('detects $addToSet targeting a dotted locked sub-path', function () {
      expect(modifierTouchesAccountStatus({$addToSet: {'accountStatusInfo.history': {at: 1}}})).to.be.true;
    });

    it('detects a locked field mixed among several operators', function () {
      expect(modifierTouchesAccountStatus({
        $set: {'profile.name': 'X'},
        $inc: {'accountClearing.score': 1}
      })).to.be.true;
    });
  });

  describe('deep dotted sub-paths', function () {
    it('detects a deep dotted accountStatusInfo.by.userId', function () {
      expect(modifierTouchesAccountStatus({$set: {'accountStatusInfo.by.userId': 'attacker'}})).to.be.true;
    });

    it('detects a deep dotted accountClearing.reason.text', function () {
      expect(modifierTouchesAccountStatus({$set: {'accountClearing.reason.text': 'x'}})).to.be.true;
    });

    it('detects a replacement doc carrying accountStatus alongside other fields', function () {
      expect(modifierTouchesAccountStatus({
        username: 'abc',
        accountStatus: 'active',
        profile: {name: 'Y'}
      })).to.be.true;
    });
  });

  describe('empty / array / prefix edge inputs', function () {
    it('returns false for an empty object', function () {
      expect(modifierTouchesAccountStatus({})).to.be.false;
    });

    it('returns false for an empty $set operand', function () {
      expect(modifierTouchesAccountStatus({$set: {}})).to.be.false;
    });

    it('returns false for an array input (empty and populated)', function () {
      expect(modifierTouchesAccountStatus([])).to.be.false;
      expect(modifierTouchesAccountStatus(['accountStatus'])).to.be.false;
    });

    it('returns false for a bare "accountStatusX" prefix key (no dot boundary)', function () {
      expect(modifierTouchesAccountStatus({$set: {accountStatusX: 1}})).to.be.false;
      expect(modifierTouchesAccountStatus({$set: {accountStatusInfoExtra: 1}})).to.be.false;
      expect(modifierTouchesAccountStatus({accountClearingX: 1})).to.be.false;
    });

    it('returns false when an operand is null or a primitive', function () {
      expect(modifierTouchesAccountStatus({$set: null})).to.be.false;
      expect(modifierTouchesAccountStatus({$currentDate: true})).to.be.false;
    });
  });
});
