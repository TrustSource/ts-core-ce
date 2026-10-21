/* eslint-disable no-undef */
// A real SPDX document carries a FLAT `packages` list plus a `relationships` graph. The importer
// read only the nested-`packages` form, so every standard document arrived as one flat level and
// the dependency structure it described was lost.
const {buildSpdxGraph, packageId} = require('../../imports/lib/spdx/relationshipGraph');

const pkg = (id, name) => ({SPDXID: id, name: name || id.replace('SPDXRef-', '')});
const rel = (from, type, to) =>
  ({spdxElementId: from, relationshipType: type, relatedSpdxElement: to});

describe('buildSpdxGraph - dependency edges', () => {
  it('reads DEPENDS_ON as parent -> child', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')], [rel('a', 'DEPENDS_ON', 'b')]);
    expect(g.hasGraph).toBe(true);
    expect(g.childrenOf.a).toEqual(['b']);
    expect(g.rootIds).toEqual(['a']);
  });

  it('reads DEPENDENCY_OF as the same edge reversed', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')], [rel('b', 'DEPENDENCY_OF', 'a')]);
    expect(g.childrenOf.a).toEqual(['b']);
    expect(g.rootIds).toEqual(['a']);
  });

  it.each([
    ['CONTAINS', 'a', 'b'],
    ['HAS_PREREQUISITE', 'a', 'b']
  ])('treats %s as parent -> child', (type, from, to) => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')], [rel(from, type, to)]);
    expect(g.childrenOf.a).toEqual(['b']);
  });

  it.each([
    ['CONTAINED_BY'],
    ['PREREQUISITE_FOR']
  ])('treats %s as child -> parent', (type) => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')], [rel('b', type, 'a')]);
    expect(g.childrenOf.a).toEqual(['b']);
  });

  it('is case-insensitive about the relationship type', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')], [rel('a', 'depends_on', 'b')]);
    expect(g.childrenOf.a).toEqual(['b']);
  });

  it('ignores relationship types that carry no containment meaning', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')],
      [rel('a', 'GENERATED_FROM', 'b'), rel('a', 'PATCH_FOR', 'b'), rel('a', 'BUILD_TOOL_OF', 'b')]);
    expect(g.hasGraph).toBe(false);
    expect(g.childrenOf).toEqual({});
  });
});

describe('buildSpdxGraph - roots', () => {
  it('uses what the document DESCRIBES as the root', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')],
      [rel('SPDXRef-DOCUMENT', 'DESCRIBES', 'a'), rel('a', 'DEPENDS_ON', 'b')]);
    expect(g.rootIds).toEqual(['a']);
  });

  it('accepts DESCRIBED_BY written the other way round', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')],
      [rel('a', 'DESCRIBED_BY', 'SPDXRef-DOCUMENT'), rel('a', 'DEPENDS_ON', 'b')]);
    expect(g.rootIds).toEqual(['a']);
  });

  it('honours a non-default document id', () => {
    const g = buildSpdxGraph([pkg('a')], [rel('SPDXRef-doc-1', 'DESCRIBES', 'a')], 'SPDXRef-doc-1');
    expect(g.rootIds).toEqual(['a']);
    expect(g.hasGraph).toBe(true);
  });

  it('KEEPS a package that appears in no relationship at all', () => {
    // Dropping it would silently lose a component the document listed.
    const g = buildSpdxGraph([pkg('a'), pkg('b'), pkg('orphan')], [rel('a', 'DEPENDS_ON', 'b')]);
    expect(g.rootIds).toContain('orphan');
    expect(g.rootIds).toContain('a');
    expect(g.rootIds).not.toContain('b');
  });

  it('orders roots as the document lists them, so re-imports are stable', () => {
    const g = buildSpdxGraph([pkg('z'), pkg('y'), pkg('x')], [rel('z', 'DEPENDS_ON', 'x')]);
    expect(g.rootIds).toEqual(['z', 'y']);
  });
});

describe('buildSpdxGraph - hostile and malformed input', () => {
  it('reports no graph when relationships are absent or empty', () => {
    expect(buildSpdxGraph([pkg('a')], undefined).hasGraph).toBe(false);
    expect(buildSpdxGraph([pkg('a')], []).hasGraph).toBe(false);
    expect(buildSpdxGraph([pkg('a')], null).hasGraph).toBe(false);
  });

  it('survives a missing or non-array packages list', () => {
    expect(() => buildSpdxGraph(undefined, [])).not.toThrow();
    expect(buildSpdxGraph(undefined, []).rootIds).toEqual([]);
    expect(buildSpdxGraph('nope', []).orderedIds).toEqual([]);
  });

  it('drops an edge to an element this document does not contain', () => {
    // A file, or an external document reference - there is no component to place.
    const g = buildSpdxGraph([pkg('a')],
      [rel('a', 'DEPENDS_ON', 'SPDXRef-File-1'), rel('SPDXRef-External', 'DEPENDS_ON', 'a')]);
    expect(g.childrenOf).toEqual({});
    expect(g.rootIds).toEqual(['a']);
  });

  it('ignores malformed relationship entries instead of throwing', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')],
      [null, {}, {relationshipType: 'DEPENDS_ON'}, {spdxElementId: 'a', relationshipType: 7},
        rel('a', 'DEPENDS_ON', 'b')]);
    expect(g.childrenOf.a).toEqual(['b']);
  });

  it('refuses a self-edge', () => {
    const g = buildSpdxGraph([pkg('a')], [rel('a', 'DEPENDS_ON', 'a')]);
    expect(g.childrenOf.a).toBeUndefined();
  });

  it('de-duplicates a repeated edge', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b')],
      [rel('a', 'DEPENDS_ON', 'b'), rel('a', 'DEPENDS_ON', 'b'), rel('b', 'DEPENDENCY_OF', 'a')]);
    expect(g.childrenOf.a).toEqual(['b']);
  });

  it('keeps the first of two packages sharing an SPDXID', () => {
    const g = buildSpdxGraph([{SPDXID: 'a', name: 'first'}, {SPDXID: 'a', name: 'second'}], []);
    expect(g.orderedIds).toEqual(['a']);
    expect(g.byId.a.name).toBe('first');
  });

  it('gives a package with no SPDXID a positional id rather than dropping it', () => {
    const g = buildSpdxGraph([{name: 'anonymous'}], []);
    expect(g.orderedIds).toHaveLength(1);
    expect(g.rootIds).toHaveLength(1);
    expect(packageId({}, 3)).toBe('SPDXRef-Package-3');
  });
});

describe('buildSpdxGraph - cycles', () => {
  it('still surfaces a pure two-node cycle, which nothing else points at', () => {
    // libc6 <-> libgcc-s1 in any distro SBOM. Both are children, so neither is a natural root.
    const g = buildSpdxGraph([pkg('libc6'), pkg('libgcc')],
      [rel('libc6', 'DEPENDS_ON', 'libgcc'), rel('libgcc', 'DEPENDS_ON', 'libc6')]);
    expect(g.rootIds.length).toBeGreaterThan(0);
    expect(g.rootIds).toContain('libc6');
  });

  it('does not hang on a longer cycle', () => {
    const g = buildSpdxGraph([pkg('a'), pkg('b'), pkg('c')],
      [rel('a', 'DEPENDS_ON', 'b'), rel('b', 'DEPENDS_ON', 'c'), rel('c', 'DEPENDS_ON', 'a')]);
    expect(g.rootIds.length).toBeGreaterThan(0);
  });

  it('reaches a cycle that hangs off a real root without seeding it separately', () => {
    const g = buildSpdxGraph([pkg('root'), pkg('a'), pkg('b')],
      [rel('SPDXRef-DOCUMENT', 'DESCRIBES', 'root'), rel('root', 'DEPENDS_ON', 'a'),
        rel('a', 'DEPENDS_ON', 'b'), rel('b', 'DEPENDS_ON', 'a')]);
    expect(g.rootIds).toEqual(['root']);
  });

  it('every package ends up reachable from some root', () => {
    const packages = [pkg('r'), pkg('a'), pkg('b'), pkg('c'), pkg('d'), pkg('lonely')];
    const g = buildSpdxGraph(packages, [
      rel('SPDXRef-DOCUMENT', 'DESCRIBES', 'r'),
      rel('r', 'DEPENDS_ON', 'a'), rel('a', 'DEPENDS_ON', 'b'),
      rel('c', 'DEPENDS_ON', 'd'), rel('d', 'DEPENDS_ON', 'c')   // detached cycle
    ]);
    const reached = new Set();
    const stack = g.rootIds.slice();
    while (stack.length) {
      const id = stack.pop();
      if (reached.has(id)) continue;
      reached.add(id);
      (g.childrenOf[id] || []).forEach((child) => stack.push(child));
    }
    g.orderedIds.forEach((id) => expect(reached.has(id)).toBe(true));
  });
});
