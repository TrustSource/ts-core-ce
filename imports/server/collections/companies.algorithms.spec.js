import {expect} from 'chai';
import {mergeAlgorithmChoices} from './companies';

describe('collections: Companies mergeAlgorithmChoices', function () {
  it('keeps the company entries and adds the other names once, sorted', function () {
    const list = mergeAlgorithmChoices([{Algorithm: 'SHA-1', Strength: 160}],
      ['sha-1', 'DES', 'des', '', null, 'AES']);
    expect(list).to.deep.equal([
      {Algorithm: 'AES'},
      {Algorithm: 'DES'},
      {Algorithm: 'SHA-1', Strength: 160}
    ]);
  });

  it('offers names on a fresh installation without own algorithms', function () {
    expect(mergeAlgorithmChoices([], ['MD5']).map(item => item.Algorithm)).to.deep.equal(['MD5']);
  });
});
