import {expect} from 'chai';
import Companies from '/imports/lib/collections/companies';
import Scans from '/imports/lib/collections/scans';
import Modules from '/imports/lib/collections/modules';
import processScan from './processScan';

describe('processScan()', function () {
  const companyId = 'zztest-processscan-company';
  const testUser = {
    _id: 'zztest-processscan-user',
    profile: {companyId, name: 'Test User'},
    emails: [{address: 'test@example.com'}]
  };

  before(async function () {
    await Companies.removeAsync({_id: companyId});
    await Companies.insertAsync({_id: companyId, name: 'zztest processScan company'});
  });

  after(async function () {
    await Companies.removeAsync({_id: companyId});
    await Scans.removeAsync({companyId});
    await Modules.removeAsync({companyId});
  });

  it('processes a scan with no dependencies field without throwing (reproduces the reported TypeError)', async function () {
    // Mirrors a real production document: a scan submitted with zero
    // dependencies never gets a `dependencies` field at all, since
    // scans.js's cleanDoc() strips an empty/absent array before insert.
    const scanId = await Scans.insertAsync({
      companyId,
      module: 'zztest-module-no-deps'
    });

    let thrown = null;
    try {
      await processScan(scanId, testUser, companyId, false);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).to.be.null;

    const updatedScan = await Scans.findOneAsync(scanId);
    expect(updatedScan.dependencyCount).to.equal(0);
  });
});
