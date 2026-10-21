import {expect} from 'chai';
import Companies from '/imports/lib/collections/companies';
import Approves from '/imports/lib/collections/approves';
import {decrypt, hmac} from '/imports/lib/crypto';
import {ensureReleaseKey, createReleaseKey} from './releaseKeys';

// A release gets exactly one public key, without a logged-in user (#42).
describe('ensureReleaseKey (#42)', function () {
  const companyId = 'cmpReleaseKey1234';

  beforeEach(async function () {
    process.env.TS_ENCRYPTION_KEY = 'release-key-spec-key';
    await Companies.rawCollection().insertOne({_id: companyId, publicReleaseKeys: []});
    await Approves.rawCollection().insertOne({_id: 'releaseKeyAppr1', companyId});
    await Approves.rawCollection().insertOne({_id: 'releaseKeyAppr2', companyId: 'otherCompany12345'});
  });

  afterEach(async function () {
    delete process.env.TS_ENCRYPTION_KEY;
    await Companies.rawCollection().deleteOne({_id: companyId});
    await Approves.rawCollection().deleteMany({_id: {$in: ['releaseKeyAppr1', 'releaseKeyAppr2']}});
  });

  async function keys() {
    return (await Companies.rawCollection().findOne({_id: companyId})).publicReleaseKeys;
  }

  it('creates a published key once and returns it again', async function () {
    const first = await ensureReleaseKey(companyId, 'releaseKeyAppr1', {published: true});
    expect(first.published).to.equal(true);
    const second = await ensureReleaseKey(companyId, 'releaseKeyAppr1', {published: true});
    expect(second.key).to.equal(first.key);
    expect(await keys()).to.have.length(1);
  });

  it('publishes an existing unpublished key', async function () {
    const created = await ensureReleaseKey(companyId, 'releaseKeyAppr1');
    expect(created.published).to.be.undefined;
    await ensureReleaseKey(companyId, 'releaseKeyAppr1', {published: true});
    const [stored] = await keys();
    expect(stored.published).to.equal(true);
    expect(stored.unpublished).to.equal(false);
  });

  it('#46 stores the key encrypted with its hash, mask and id', async function () {
    await ensureReleaseKey(companyId, 'releaseKeyAppr1', {published: true});
    const [stored] = await keys();
    expect(stored.key.startsWith('v2:')).to.equal(true);
    const plain = decrypt(stored.key);
    expect(stored.keyHash).to.equal(hmac(plain));
    expect(stored.maskedKey).to.be.a('string').and.not.contain(plain);
    expect(stored.id).to.be.a('string');
  });

  it('createReleaseKey always adds a key', async function () {
    await ensureReleaseKey(companyId, 'releaseKeyAppr1');
    await createReleaseKey(companyId, 'releaseKeyAppr1');
    expect(await keys()).to.have.length(2);
    expect(await createReleaseKey(companyId, 'releaseKeyAppr2')).to.equal(null);
  });

  it('refuses a release of another company', async function () {
    expect(await ensureReleaseKey(companyId, 'releaseKeyAppr2', {published: true})).to.equal(null);
    expect(await keys()).to.have.length(0);
  });
});
