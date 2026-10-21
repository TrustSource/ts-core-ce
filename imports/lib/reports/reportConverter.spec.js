import {expect} from 'chai';
import reportConverter from './reportConverter';

describe('reportConverter.bomToSPDX', function () {
  it('writes a valid SPDX version', function () {
    const spdx = reportConverter.bomToSPDX({}, {format: 'json'});
    expect(spdx.spdxVersion).to.equal('SPDX-2.3');
  });
});
