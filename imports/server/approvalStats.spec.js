import {expect} from 'chai';
import Approves from '/imports/lib/collections/approves';
import {writeApprovalStats} from './approvalStats';

// Background report generation runs without a user; stats.notice must still be set (#60).
describe('approval stats (#60)', function () {
  const companyId = 'cmpApprovalStats1';

  beforeEach(async function () {
    await Approves.rawCollection().insertOne({_id: 'apprStats1', companyId});
  });

  afterEach(async function () {
    await Approves.rawCollection().deleteOne({_id: 'apprStats1'});
  });

  async function stats() {
    return (await Approves.rawCollection().findOne({_id: 'apprStats1'})).stats;
  }

  const figures = {components: 12, obligations: 5, completed: 40, totalActivity: 10, completedActivity: 4};

  it('writes the figures of the approval in the file\'s company, without a user', async function () {
    await writeApprovalStats('notice', Object.assign({approveId: 'apprStats1', companyId}, figures));
    expect((await stats()).notice).to.deep.equal(figures);
  });

  it('ignores an update that changed none of the figures, and another company\'s approval', async function () {
    await writeApprovalStats('notice', Object.assign({approveId: 'apprStats1', companyId}, figures), ['licenses']);
    expect(await stats()).to.be.undefined;
    await writeApprovalStats('sbom', Object.assign({approveId: 'apprStats1', companyId: 'otherCompany12345'}, figures));
    expect(await stats()).to.be.undefined;
  });
});
