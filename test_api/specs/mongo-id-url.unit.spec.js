// cotsComponents and infrastructureComponents store real Mongo ObjectIds, which
// broke their detail URLs two ways: Router.go stringified the id into
// ObjectID("<hex>"), and findOne('<hex>') never matched an ObjectId _id.
//
// unwrapId/isWrappedId are pure string work, so they are pinned here. idSelector
// and idParam touch meteor/mongo and are exercised in the browser instead.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(
  path.join(__dirname, '../../imports/lib/mongoId.js'), 'utf8');

// Re-evaluate just the regexes and the two pure functions, without the
// meteor/mongo import Jest cannot resolve.
const HEX_24 = /^[0-9a-f]{24}$/i;
const WRAPPED = /^ObjectID\(\s*["']?([0-9a-f]{24})["']?\s*\)$/i;

function unwrapId(raw) {
  if (!raw) return raw;
  const match = String(raw).match(WRAPPED);
  return match ? match[1] : String(raw);
}
function isWrappedId(raw) {
  return !!raw && WRAPPED.test(String(raw));
}

describe('ObjectId route params', () => {
  const HEX = '6a196d9c71506d42ad664d07';

  it('keeps the source regexes in step with the copies under test', () => {
    // Guards against the module drifting from this spec's inlined copies.
    expect(SRC).toContain(HEX_24.source);
    expect(SRC).toContain(WRAPPED.source);
  });

  it('unwraps the stringified form Router.go produced', () => {
    expect(unwrapId('ObjectID("' + HEX + '")')).toBe(HEX);
    expect(isWrappedId('ObjectID("' + HEX + '")')).toBe(true);
  });

  it('unwraps the single-quoted and bare variants too', () => {
    expect(unwrapId("ObjectID('" + HEX + "')")).toBe(HEX);
    expect(unwrapId('ObjectID(' + HEX + ')')).toBe(HEX);
  });

  it('leaves a clean hex id alone, so a healed URL stays healed', () => {
    expect(unwrapId(HEX)).toBe(HEX);
    expect(isWrappedId(HEX)).toBe(false);
  });

  it('leaves a Meteor string id alone', () => {
    expect(unwrapId('cG7TqxxcYHFrM7FqQ')).toBe('cG7TqxxcYHFrM7FqQ');
    expect(isWrappedId('cG7TqxxcYHFrM7FqQ')).toBe(false);
  });

  it('does not treat a non-hex payload as wrapped', () => {
    expect(isWrappedId('ObjectID("not-a-hex-id")')).toBe(false);
    expect(isWrappedId('ObjectID("6a196d9c71506d42ad664d0")')).toBe(false); // 23 chars
  });

  it('covers every route whose :_id is an ObjectId component', () => {
    // One global onBeforeAction heals all of them, so the list must not drift
    // from the routes that actually exist.
    const ROUTER = fs.readFileSync(
      path.join(__dirname, '../../imports/lib/router.js'), 'utf8');
    const list = ROUTER.match(/const OBJECT_ID_ID_ROUTES = \[([\s\S]*?)\]/);
    expect(list).not.toBeNull();
    const names = list[1].match(/'([^']+)'/g).map(n => n.replace(/'/g, ''));
    expect(names).toHaveLength(6);
    names.forEach(n => expect(ROUTER).toContain("name: '" + n + "'"));
    // the two detail routes plus the four /management/* edit and logs routes
    expect(names).toContain('cotsComponentDetails');
    expect(names).toContain('infrastructureComponentDetails');
    expect(names.filter(n => /Management/.test(n))).toHaveLength(4);
  });

  it('survives empty and missing input', () => {
    expect(unwrapId('')).toBe('');
    expect(unwrapId(null)).toBe(null);
    expect(unwrapId(undefined)).toBe(undefined);
    expect(isWrappedId(null)).toBe(false);
  });
});
