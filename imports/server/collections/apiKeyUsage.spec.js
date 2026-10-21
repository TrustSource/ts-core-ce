import {expect} from 'chai';
import ApiKeyUsage from '/imports/lib/collections/apiKeyUsage';
import {recordApiKeyUsage, apiKeyUsageForCompany} from './apiKeyUsage';

describe('apiKeyUsage (#27)', function () {
  const companyId = 'cmpApiUsage123456';

  beforeEach(async function () {
    await ApiKeyUsage.removeAsync({companyId});
  });

  afterEach(async function () {
    await ApiKeyUsage.removeAsync({companyId});
  });

  it('counts requests per key and day', async function () {
    const day1 = new Date('2026-10-10T08:00:00Z');
    const day2 = new Date('2026-10-11T23:59:00Z');
    await recordApiKeyUsage(companyId, 'k1', day1);
    await recordApiKeyUsage(companyId, 'k1', day1);
    await recordApiKeyUsage(companyId, 'k1', day2);
    await recordApiKeyUsage(companyId, 'k2', day2);

    const usage = await apiKeyUsageForCompany(companyId, 30, new Date('2026-10-12T00:00:00Z'));
    expect(usage.k1).to.deep.equal({total: 3, days: {'2026-10-10': 2, '2026-10-11': 1}});
    expect(usage.k2.total).to.equal(1);
  });

  it('leaves out days before the window and other companies', async function () {
    await recordApiKeyUsage(companyId, 'k1', new Date('2026-08-01T00:00:00Z'));
    await recordApiKeyUsage('otherCompany12345', 'k9', new Date('2026-10-11T00:00:00Z'));
    const usage = await apiKeyUsageForCompany(companyId, 30, new Date('2026-10-12T00:00:00Z'));
    expect(usage).to.deep.equal({});
    await ApiKeyUsage.removeAsync({companyId: 'otherCompany12345'});
  });

  it('ignores a key without an id', async function () {
    await recordApiKeyUsage(companyId, undefined);
    expect(await ApiKeyUsage.find({companyId}).countAsync()).to.equal(0);
  });
});
