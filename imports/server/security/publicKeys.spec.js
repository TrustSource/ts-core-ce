import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import '/imports/server/collections/companies';
import Companies from '/imports/lib/collections/companies';
import {decrypt, hmac} from '/imports/lib/crypto';
import {upgradePublicKeys} from './publicKeys';

// Release and CSAF feed keys are stored encrypted and found by their hash (#46).
describe('public release and CSAF feed keys (#46)', function () {
  const companyId = 'cmpPublicKeys1234';
  const plainRelease = 'aaaa1111-2222-3333-4444-555555555555';
  const plainCsaf = 'bbbb1111-2222-3333-4444-666666666666';

  beforeEach(async function () {
    process.env.TS_ENCRYPTION_KEY = 'public-keys-spec-key';
    // Keys as an installation stored them before encryption.
    await Companies.rawCollection().insertOne({
      _id: companyId,
      publicReleaseKeys: [{key: plainRelease, releaseId: 'rel1', published: true, scope: ['sbom'], requests: []}],
      publicCsafKeys: [{key: plainCsaf, name: 'feed', tlpLevels: ['WHITE'], published: true, requests: []}]
    });
  });

  afterEach(async function () {
    sinon.restore();
    delete process.env.TS_ENCRYPTION_KEY;
    await Companies.rawCollection().deleteOne({_id: companyId});
  });

  async function stored() {
    return Companies.rawCollection().findOne({_id: companyId});
  }

  it('encrypts keys stored in plaintext, and the plaintext keeps working', async function () {
    expect(await upgradePublicKeys()).to.equal(2);
    const company = await stored();
    const release = company.publicReleaseKeys[0];
    expect(release.key.startsWith('v2:')).to.equal(true);
    expect(decrypt(release.key)).to.equal(plainRelease);
    expect(release.keyHash).to.equal(hmac(plainRelease));
    expect(release.id).to.be.a('string');
    expect(company.publicCsafKeys[0].keyHash).to.equal(hmac(plainCsaf));
    expect(await upgradePublicKeys()).to.equal(0);

    const sbomKey = await Meteor.callAsync('publicBoMKey.one', plainRelease);
    expect(sbomKey.releaseId).to.equal('rel1');
    expect(sbomKey.key).to.be.undefined;
    expect(sbomKey.keyHash).to.be.undefined;
    const access = await Meteor.callAsync('publicCsafKey.findByKey', plainCsaf);
    expect(access.companyId).to.equal(companyId);
    expect(access.csafKey.key).to.be.undefined;
  });

  it('no longer accepts the stored ciphertext or hash as a key', async function () {
    await upgradePublicKeys();
    const company = await stored();
    for (const presented of [company.publicReleaseKeys[0].key, company.publicReleaseKeys[0].keyHash]) {
      let err;
      try { await Meteor.callAsync('publicBoMKey.one', presented); } catch (e) { err = e; }
      expect(err && err.error).to.equal(404);
    }
    expect(await Meteor.callAsync('publicCsafKey.findByKey', company.publicCsafKeys[0].key)).to.equal(null);
  });

  it('records requests by the presented key', async function () {
    await upgradePublicKeys();
    await Meteor.callAsync('publicBoMKey.saveRequest', plainRelease, 'client-one');
    await Meteor.callAsync('publicCsafKey.saveRequest', plainCsaf, 'client-two');
    const company = await stored();
    expect(company.publicReleaseKeys[0].requests).to.deep.equal(['client-one']);
    expect(company.publicCsafKeys[0].requests).to.deep.equal(['client-two']);
  });

  it('reveals a key only to the roles that manage it', async function () {
    await upgradePublicKeys();
    const id = (await stored()).publicCsafKeys[0].id;
    sinon.stub(Meteor, 'userAsync').resolves({_id: 'usrPublicKeys1234', profile: {companyId}});
    const roleStub = sinon.stub(Roles, 'userIsInRoleAsync').resolves(true);
    const callAsync = Meteor.callAsync;
    sinon.stub(Meteor, 'callAsync').callsFake(function (name, ...args) {
      return name === 'logEvent' ? Promise.resolve() : callAsync.call(Meteor, name, ...args);
    });
    expect(await Meteor.callAsync('publicCsafKey.reveal', id)).to.equal(plainCsaf);
    roleStub.resolves(false);
    let err;
    try { await Meteor.callAsync('publicCsafKey.reveal', id); } catch (e) { err = e; }
    expect(err && err.error).to.equal(403);
  });
});
