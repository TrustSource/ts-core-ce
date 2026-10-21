import {expect} from 'chai';
import {planProductImport, MAX_IMPORT_PRODUCTS} from './importPlan';

describe('planProductImport (#28)', function () {
  const file = (products, relations) => ({version: 1, products, relations});
  const p = (identifier, name = identifier) => ({type: 'class', identifier, name});

  it('plans every row with its parent', function () {
    const {errors, rows} = planProductImport(file([p('1'), p('1A')], [{identifier: '1', contains: ['1A']}]),
      new Set(), undefined);
    expect(errors).to.deep.equal([]);
    expect(rows.map((r) => [r.identifier, r.parentId])).to.deep.equal([['1', undefined], ['1A', '1']]);
  });

  it('puts top-level rows under the parent chosen in the dialog', function () {
    const {rows} = planProductImport(file([p('2')], []), new Set(['root']), 'root');
    expect(rows[0].parentId).to.equal('root');
  });

  it('accepts an existing product as the parent of a relation', function () {
    const {errors} = planProductImport(file([p('3')], [{identifier: 'old', contains: ['3']}]), new Set(['old']));
    expect(errors).to.deep.equal([]);
  });

  it('reports every problem and plans nothing', function () {
    const {errors, rows} = planProductImport(file(
      [p('1'), p('1'), {identifier: '', name: 'x'}, p('dup'), {identifier: 'n'}],
      [{identifier: 'ghost', contains: ['1']}, {identifier: 'n', contains: ['missing']}]
    ), new Set(['dup']), 'nope');
    expect(rows).to.deep.equal([]);
    expect(errors.join('\n')).to.contain('Parent nope is not an existing product')
      .and.contain('Identifier 1 appears more than once')
      .and.contain('Product 3 has no identifier')
      .and.contain('already exists: dup')
      .and.contain('(n) has no name')
      .and.contain('parent ghost is neither in the file nor an existing product')
      .and.contain('missing is not a product of this file');
  });

  it('refuses cycles and a product with two parents', function () {
    expect(planProductImport(file([p('a'), p('b')],
      [{identifier: 'a', contains: ['b']}, {identifier: 'b', contains: ['a']}]), new Set()).errors.join())
      .to.contain('cycle');
    expect(planProductImport(file([p('a'), p('b'), p('c')],
      [{identifier: 'a', contains: ['c']}, {identifier: 'b', contains: ['c']}]), new Set()).errors.join())
      .to.contain('c has more than one parent');
    expect(planProductImport(file([p('a')], [{identifier: 'a', contains: ['a']}]), new Set()).errors.join())
      .to.contain('a contains itself');
  });

  it('refuses unsupported files and too many rows', function () {
    expect(planProductImport({version: 2, products: []}, new Set()).errors).to.have.length(1);
    expect(planProductImport(file([]), new Set()).errors[0]).to.contain('no products');
    const many = Array.from({length: MAX_IMPORT_PRODUCTS + 1}, (v, i) => p(String(i)));
    expect(planProductImport(file(many), new Set()).errors[0]).to.contain(`at most ${MAX_IMPORT_PRODUCTS}`);
  });
});
