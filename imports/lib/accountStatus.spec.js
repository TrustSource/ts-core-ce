import {expect} from 'chai';
import {
  ACCOUNT_STATUS,
  ACCOUNT_STATUS_FIELD,
  ACCOUNT_STATUS_INFO_FIELD,
  ACCOUNT_CLEARING_FIELD,
  ACCOUNT_STATUS_LOCKED_FIELDS,
  accountStatusOf,
  modifierTouchesAccountStatus
} from './accountStatus';

describe('accountStatus (isomorphic)', function () {

  describe('constants', function () {
    it('exposes the three status values', function () {
      expect(ACCOUNT_STATUS.ACTIVE).to.equal('active');
      expect(ACCOUNT_STATUS.SUSPICIOUS).to.equal('suspicious');
      expect(ACCOUNT_STATUS.SUSPENDED).to.equal('suspended');
    });

    it('exposes the locked field names', function () {
      expect(ACCOUNT_STATUS_FIELD).to.equal('accountStatus');
      expect(ACCOUNT_STATUS_INFO_FIELD).to.equal('accountStatusInfo');
      expect(ACCOUNT_CLEARING_FIELD).to.equal('accountClearing');
      expect(ACCOUNT_STATUS_LOCKED_FIELDS).to.deep.equal([
        'accountStatus', 'accountStatusInfo', 'accountClearing'
      ]);
    });
  });

  describe('accountStatusOf', function () {
    it('returns suspended for a suspended user', function () {
      expect(accountStatusOf({accountStatus: 'suspended'})).to.equal('suspended');
    });

    it('returns suspicious for a suspicious user', function () {
      expect(accountStatusOf({accountStatus: 'suspicious'})).to.equal('suspicious');
    });

    it('returns active for an explicitly active user', function () {
      expect(accountStatusOf({accountStatus: 'active'})).to.equal('active');
    });

    it('returns active when the field is absent', function () {
      expect(accountStatusOf({})).to.equal('active');
    });

    it('returns active for an unknown/empty status value', function () {
      expect(accountStatusOf({accountStatus: 'whatever'})).to.equal('active');
      expect(accountStatusOf({accountStatus: ''})).to.equal('active');
    });

    it('returns active for null/undefined input', function () {
      expect(accountStatusOf(null)).to.equal('active');
      expect(accountStatusOf(undefined)).to.equal('active');
    });
  });

  describe('modifierTouchesAccountStatus', function () {
    it('detects a top-level $set of accountStatus', function () {
      expect(modifierTouchesAccountStatus({$set: {accountStatus: 'suspended'}})).to.be.true;
    });

    it('detects a dotted $set of accountClearing.score', function () {
      expect(modifierTouchesAccountStatus({$set: {'accountClearing.score': 9}})).to.be.true;
    });

    it('detects accountStatusInfo in a modifier', function () {
      expect(modifierTouchesAccountStatus({$set: {accountStatusInfo: {reason: 'x'}}})).to.be.true;
    });

    it('detects an $unset of a locked field', function () {
      expect(modifierTouchesAccountStatus({$unset: {accountStatus: 1}})).to.be.true;
    });

    it('detects a locked field in a replacement doc (no operators)', function () {
      expect(modifierTouchesAccountStatus({accountStatus: 'active', profile: {}})).to.be.true;
    });

    it('detects a $rename whose TARGET is a locked field', function () {
      expect(modifierTouchesAccountStatus({$rename: {legacyStatus: 'accountStatus'}})).to.be.true;
    });

    it('detects a $rename whose SOURCE is a locked field', function () {
      expect(modifierTouchesAccountStatus({$rename: {accountStatus: 'somethingElse'}})).to.be.true;
    });

    it('detects a locked field under a non-$set operator ($inc)', function () {
      expect(modifierTouchesAccountStatus({$inc: {'accountClearing.score': 1}})).to.be.true;
    });

    it('returns false for an unrelated modifier', function () {
      expect(modifierTouchesAccountStatus({$set: {'profile.name': 'X'}})).to.be.false;
      expect(modifierTouchesAccountStatus({$set: {'intro.chat': true}})).to.be.false;
    });

    it('returns false for an unrelated replacement doc', function () {
      expect(modifierTouchesAccountStatus({profile: {name: 'X'}, username: 'y'})).to.be.false;
    });

    it('is not fooled by a field that merely starts with a locked name', function () {
      expect(modifierTouchesAccountStatus({$set: {accountStatusExtra: 1}})).to.be.false;
      expect(modifierTouchesAccountStatus({$set: {accountClearingFoo: 1}})).to.be.false;
    });

    it('returns false for null / non-object input', function () {
      expect(modifierTouchesAccountStatus(null)).to.be.false;
      expect(modifierTouchesAccountStatus(undefined)).to.be.false;
      expect(modifierTouchesAccountStatus('string')).to.be.false;
      expect(modifierTouchesAccountStatus(42)).to.be.false;
    });
  });
});
