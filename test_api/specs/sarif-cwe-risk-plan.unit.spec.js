/* eslint-disable no-undef*/
// Auto-create and reconcile one Risk per (module, tool, CWE) from
// the weaknesses a SARIF document publishes.
//
// Every decision this feature makes lives in imports/lib/sarif/cweRiskPlan.js, a
// pure CommonJS module with no meteor/* imports, so it can be required straight
// into Jest (AC31) - the same dual-consumption pattern as cweExtract.js,
// runStatus.js and findingSummary.js. `yarn meteor-test` is broken at boot in
// this repo and is deliberately NOT a prerequisite for any of this.
//
// The SARIF shapes below are the ones the tools really emit (they are the shapes
// sarif-cwe-extract.unit.spec.js copied out of real CodeQL / semgrep / Bandit
// documents), not invented ones.
const {
  AUTO_KEY_PREFIX,
  AUTO_KEY_SEPARATOR,
  SOURCE_REFS_MAX,
  SOURCE_REF_LEVELS,
  SOURCE_REF_LEVEL_LABEL,
  RISK_NAME_MAX,
  AUTO_KEY_MAX,
  AUTO_TOOL_MAX,
  SOURCE_REF_RULE_ID_MAX,
  SOURCE_REF_URI_MAX,
  CWE_RISKS_MAX_PER_TOOL,
  CWE_RISK_MAX_TOOLS,
  CWE_RISKS_MAX_PER_IMPORT,
  SARIF_RECONCILE_MAX_TESTS,
  toolKeySegment,
  buildAutoKey,
  buildRiskName,
  toolLabel,
  collectRunSourceRefs,
  finalizeSourceRefs,
  planCweRisks
} = require('../../imports/lib/sarif/cweRiskPlan');

// The two anti-XSS regexes RiskSchema.name carries (riskSchema.js). A generated
// name that fails either of them is rejected by collection2 deep inside the
// insert, and the feature then silently produces nothing for that tool.
const RISK_NAME_REGEXES = [
  /^[^<>]*$/,
  /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/
];

const MODULE_ID = 'aaaaaaaaaaaaaaaaa';

function result(ruleId, uri, level) {
  const res = {ruleId};
  if (level) {
    res.level = level;
  }
  if (uri !== null) {
    res.locations = [{physicalLocation: {artifactLocation: {uri}}}];
  }
  return res;
}

function repeat(ruleId, uri, level, times) {
  const out = [];
  for (let i = 0; i < times; i += 1) {
    out.push(result(ruleId, uri, level));
  }
  return out;
}

// A semgrep document: 15 results, 6 files, 3 rules, 5 distinct weaknesses.
// Rule C is tagged with three CWEs, which is what makes AC8 non-trivial here.
const SEMGREP_RULES = [
  {id: 'javascript.express.security.audit.xss.direct-response-write',
    properties: {cwe: ['CWE-79: Improper Neutralization of Input During Web Page Generation'],
      category: 'security'},
    defaultConfiguration: {level: 'error'}},
  {id: 'python.lang.security.audit.subprocess-shell-true',
    properties: {tags: ['CWE-78: OS Command Injection', 'OWASP-A03:2021 - Injection', 'security']},
    defaultConfiguration: {level: 'warning'}},
  {id: 'py/path-injection',
    properties: {tags: ['external/cwe/cwe-022', 'external/cwe/cwe-023', 'external/cwe/cwe-036']},
    defaultConfiguration: {level: 'note'}}
];

const RULE_A = SEMGREP_RULES[0].id;
const RULE_B = SEMGREP_RULES[1].id;
const RULE_C = SEMGREP_RULES[2].id;

function semgrepRun(level) {
  return {
    tool: {driver: {name: 'semgrep', rules: SEMGREP_RULES}},
    results: [].concat(
      repeat(RULE_A, 'src/app/render.js', level || 'error', 3),
      repeat(RULE_A, 'src/app/reply.js', level || 'error', 2),
      repeat(RULE_A, 'src/app/index.js', level || 'error', 1),
      repeat(RULE_B, 'src/app/index.js', level || 'warning', 2),
      repeat(RULE_B, 'tools/deploy.py', level || 'warning', 2),
      repeat(RULE_C, 'tools/archive.py', level || 'note', 3),
      repeat(RULE_C, 'tools/unpack.py', level || 'note', 2)
    )
  };
}

function planOf(documents, moduleId) {
  return planCweRisks({moduleId: moduleId === undefined ? MODULE_ID : moduleId, documents});
}

function toolNamed(plan, tool) {
  return plan.tools.find((entry) => entry.tool === tool) || null;
}

function riskFor(plan, tool, cwe) {
  const bucket = toolNamed(plan, tool);
  return (bucket && bucket.risks.find((risk) => risk.cwe === cwe)) || null;
}

describe('#129 constants - the bounds the whole feature is written against', () => {
  it('publishes the identity, cap and level constants the writer and the UI share', () => {
    expect(AUTO_KEY_PREFIX).toEqual('sarif-cwe');
    expect(AUTO_KEY_SEPARATOR).toEqual('|');
    expect(SOURCE_REFS_MAX).toEqual(1000);
    expect(RISK_NAME_MAX).toEqual(200);
    expect(AUTO_KEY_MAX).toEqual(300);
    expect(CWE_RISKS_MAX_PER_TOOL).toEqual(200);
    expect(SARIF_RECONCILE_MAX_TESTS).toEqual(200);
  });

  // --- added with the security fix round (major finding 1) ------------------
  //
  // CWE_RISKS_MAX_PER_TOOL bounds risks PER TOOL and SOURCE_REFS_MAX bounds
  // entries PER RISK. Neither bounded the number of TOOLS, and TestImportsCreate
  // makes one tool bucket per SARIF *run* - so one upload declaring N runs with N
  // distinct driver names planned N x 200 risks (measured: 40,000 from a 426 KB
  // body, ~120,000 Mongo ops, all before response.end).
  it('publishes a tool-count cap, a global cap and the two entry field caps', () => {
    expect(CWE_RISK_MAX_TOOLS).toEqual(8);
    expect(CWE_RISKS_MAX_PER_IMPORT).toEqual(400);
    expect(SOURCE_REF_RULE_ID_MAX).toEqual(256);
    expect(SOURCE_REF_URI_MAX).toEqual(1024);
    expect(AUTO_TOOL_MAX).toEqual(200);
    // Single digits: a real scan reports one to three tools. A cap in the tens
    // would still leave the product with the per-tool cap large enough to matter.
    expect(CWE_RISK_MAX_TOOLS).toBeLessThan(10);
    // The global cap has to be the binding one - otherwise the two multiply.
    expect(CWE_RISKS_MAX_PER_IMPORT)
      .toBeLessThan(CWE_RISK_MAX_TOOLS * CWE_RISKS_MAX_PER_TOOL);
  });

  it('orders the levels violations -> warnings -> notes and labels them', () => {
    expect(SOURCE_REF_LEVELS).toEqual(['error', 'warning', 'note']);
    expect(SOURCE_REF_LEVEL_LABEL).toEqual({error: 'violation', warning: 'warning', note: 'note'});
  });
});

describe('#129 toolKeySegment / buildAutoKey - the identity key', () => {
  it('is the normalized driver name for every real tool name', () => {
    // AC7 quotes the key literally, so this has to be the identity function for
    // anything a driver actually calls itself.
    expect(toolKeySegment('semgrep')).toEqual('semgrep');
    expect(toolKeySegment('  CodeQL ')).toEqual('codeql');
    expect(toolKeySegment('Bandit')).toEqual('bandit');
    expect(toolKeySegment('trivy-fs')).toEqual('trivy-fs');
  });

  it('refuses a run whose driver publishes no usable name', () => {
    // A `sarif-cwe|<moduleId>||CWE-79` key would collide every unnamed tool into
    // one Risk, so such a run contributes nothing at all.
    [null, undefined, '', '   ', 42, {}, []].forEach((raw) => {
      expect(toolKeySegment(raw)).toBeNull();
    });
  });

  it('refuses a driver name longer than the tool cap', () => {
    expect(toolKeySegment('x'.repeat(200))).toEqual('x'.repeat(200));
    expect(toolKeySegment('x'.repeat(201))).toBeNull();
  });

  it('escapes the only two characters that could forge a segment boundary', () => {
    expect(toolKeySegment('a|b')).toEqual('a%7Cb');
    expect(toolKeySegment('a%b')).toEqual('a%25b');
    // `%` first, or `a|b` and `a%7Cb` would both escape to the same segment.
    // (Lower-cased before escaping, so the `C` of an already-escaped pipe is
    // itself lower-case by the time it is escaped again.)
    expect(toolKeySegment('a%7Cb')).toEqual('a%257cb');
    expect(toolKeySegment('a|b')).not.toEqual(toolKeySegment('a%7Cb'));
  });

  it('builds the key AC7 spells out', () => {
    expect(buildAutoKey(MODULE_ID, 'semgrep', 'CWE-79'))
      .toEqual('sarif-cwe|' + MODULE_ID + '|semgrep|CWE-79');
  });

  it('returns null instead of a key that could never be stored', () => {
    expect(buildAutoKey('', 'semgrep', 'CWE-79')).toBeNull();
    expect(buildAutoKey(MODULE_ID, '', 'CWE-79')).toBeNull();
    expect(buildAutoKey(MODULE_ID, 'semgrep', '')).toBeNull();
    expect(buildAutoKey(MODULE_ID, 'semgrep', 'not-a-cwe')).toBeNull();
    // 200 `%` characters are inside the tool cap but escape to 600, which
    // overflows the schema's max: 300. A key that could not be stored has to be
    // refused before the insert, not by collection2 after the work is done.
    expect(buildAutoKey(MODULE_ID, toolKeySegment('%'.repeat(200)), 'CWE-79')).toBeNull();
  });

  it('never produces a key longer than the schema allows', () => {
    const key = buildAutoKey(MODULE_ID, 'x'.repeat(200), 'CWE-1234567890');
    expect(key.length).toBeLessThanOrEqual(AUTO_KEY_MAX);
  });
});

describe('#129 buildRiskName - AC13', () => {
  it('begins with the CWE, names the tool, and carries no counts', () => {
    expect(buildRiskName('CWE-79', 'semgrep')).toEqual('[CWE-79] Weakness reported by Semgrep');
    // Deterministic in (cwe, tool) alone: called twice, called for a document
    // with a different number of findings, it is the same string.
    expect(buildRiskName('CWE-79', 'semgrep')).toEqual(buildRiskName('CWE-79', 'semgrep'));
    expect(buildRiskName('CWE-79', 'codeql')).not.toEqual(buildRiskName('CWE-79', 'semgrep'));
  });

  it('stays inside RiskSchema.name and passes both of its anti-XSS regexes', () => {
    const hostile = '<script>alert(1)</script>';
    const names = [
      buildRiskName('CWE-79', 'semgrep'),
      buildRiskName('CWE-1234', 'codeql'),
      buildRiskName('CWE-22', hostile),
      buildRiskName('CWE-22', 'onerror=alert`1`'),
      buildRiskName('CWE-22', 'javascript:alert(1)'),
      buildRiskName('CWE-22', 'x'.repeat(400))
    ];
    names.forEach((name) => {
      expect(name.length).toBeLessThanOrEqual(RISK_NAME_MAX);
      expect(name.length).toBeGreaterThanOrEqual(3);
      RISK_NAME_REGEXES.forEach((regEx) => {
        expect(regEx.test(name)).toBe(true);
      });
    });
  });

  it('says so rather than producing a dangling name for a nameless tool', () => {
    expect(buildRiskName('CWE-79', ''))
      .toEqual('[CWE-79] Weakness reported by a tool with an unsupported name');
  });

  // AC13 asks for a name that is a deterministic function OF the normalized
  // tool, not for the identity function. The normalized tool is lower-cased so
  // a CWE mapping entered against "CodeQL" reaches a document that stored
  // "codeql" - but a risk NAME is written once and never rewritten, so without
  // this map every risk ever minted keeps `codeql` as its permanent title.
  it('spells the known tools the way the product does, and still deterministically', () => {
    expect(buildRiskName('CWE-79', 'codeql')).toEqual('[CWE-79] Weakness reported by CodeQL');
    expect(buildRiskName('CWE-79', 'sonarqube')).toEqual('[CWE-79] Weakness reported by SonarQube');
    expect(buildRiskName('CWE-79', 'snyk code')).toEqual('[CWE-79] Weakness reported by Snyk Code');
    expect(buildRiskName('CWE-79', 'bandit')).toEqual('[CWE-79] Weakness reported by Bandit');
    expect(buildRiskName('CWE-79', 'trivy')).toEqual('[CWE-79] Weakness reported by Trivy');
    expect(buildRiskName('CWE-79', 'gitleaks')).toEqual('[CWE-79] Weakness reported by Gitleaks');
    // Still a pure function of the normalized tool, and still injective on the
    // spellings that matter.
    expect(buildRiskName('CWE-79', 'codeql')).toEqual(buildRiskName('CWE-79', 'codeql'));
    expect(new Set(['codeql', 'semgrep', 'sonarqube', 'snyk code', 'bandit', 'trivy',
      'gitleaks', 'checkov'].map((tool) => buildRiskName('CWE-79', tool))).size).toEqual(8);
  });

  it('falls back to the tool\'s own filtered spelling when it is not in the map', () => {
    expect(buildRiskName('CWE-79', 'checkov')).toEqual('[CWE-79] Weakness reported by checkov');
  });

  // The map is read with hasOwnProperty: it is a plain object literal indexed by
  // uploaded content, so `constructor` would otherwise return a function.
  it('is not fooled by a tool that names a member of Object.prototype', () => {
    ['constructor', 'toString', '__proto__', 'hasOwnProperty'].forEach((tool) => {
      const name = buildRiskName('CWE-79', tool);
      expect(name).not.toContain('native code');
      expect(name).not.toContain('function');
      expect(name.length).toBeLessThanOrEqual(RISK_NAME_MAX);
    });
  });
});

describe('#129 collectRunSourceRefs - one entry per (ruleId, uri, level)', () => {
  it('carries the exact five keys, with the normalized tool (AC10)', () => {
    const byCwe = collectRunSourceRefs(semgrepRun(), 'semgrep');
    const entries = byCwe['CWE-79'];
    expect(Object.keys(entries[0])).toEqual(['tool', 'ruleId', 'uri', 'level', 'count']);
    expect(entries[0].tool).toEqual('semgrep');
  });

  it('counts repeats of the same triple instead of listing them', () => {
    const byCwe = collectRunSourceRefs(semgrepRun(), 'semgrep');
    const entries = byCwe['CWE-79'];
    expect(entries.length).toEqual(3);
    const render = entries.find((entry) => entry.uri === 'src/app/render.js');
    expect(render).toEqual({tool: 'semgrep', ruleId: RULE_A, uri: 'src/app/render.js',
      level: 'error', count: 3});
  });

  it('counts a result with no resolvable location under an empty uri (AC10)', () => {
    const run = {
      tool: {driver: {name: 'Bandit', rules: [
        {id: 'B602', properties: {tags: ['CWE-78: OS Command Injection']}}
      ]}},
      // A finding SARIF 2.1.0 3.27.12 allows to carry no `locations` at all.
      results: [{ruleId: 'B602'}, {ruleId: 'B602'}]
    };
    expect(collectRunSourceRefs(run, 'bandit')['CWE-78'])
      .toEqual([{tool: 'bandit', ruleId: 'B602', uri: '', level: 'warning', count: 2}]);
  });

  it('counts a result reported in n files once per file', () => {
    const run = {
      tool: {driver: {name: 'semgrep', rules: [SEMGREP_RULES[0]]}},
      results: [{ruleId: RULE_A, locations: [
        {physicalLocation: {artifactLocation: {uri: 'a.js'}}},
        {physicalLocation: {artifactLocation: {uri: 'b.js'}}},
        // The same file twice in one result is one occurrence, not two.
        {physicalLocation: {artifactLocation: {uri: 'a.js'}}}
      ]}]
    };
    const entries = collectRunSourceRefs(run, 'semgrep')['CWE-79'];
    expect(entries.map((entry) => [entry.uri, entry.count]).sort())
      .toEqual([['a.js', 1], ['b.js', 1]]);
  });

  it('leaves a rule the tool published no CWE for out entirely', () => {
    const run = {
      tool: {driver: {name: 'Bandit', rules: [
        {id: 'B104', helpUri: 'https://bandit.readthedocs.io/en/1.7.4/plugins/b104.html'}
      ]}},
      results: [result('B104', 'app.py', 'error')]
    };
    expect(collectRunSourceRefs(run, 'bandit')).toEqual({});
  });

  it('drops results that are not failures and levels it cannot bucket', () => {
    const run = {
      tool: {driver: {name: 'semgrep', rules: [SEMGREP_RULES[0]]}},
      results: [
        Object.assign(result(RULE_A, 'a.js', 'error'), {kind: 'pass'}),
        Object.assign(result(RULE_A, 'b.js', 'error'), {kind: 'informational'}),
        result(RULE_A, 'c.js', 'none')
      ]
    };
    expect(collectRunSourceRefs(run, 'semgrep')).toEqual({});
  });

  it('survives rule ids that spell prototype members', () => {
    // Rule ids come straight out of an uploaded document; `constructor` and
    // `__proto__` are the ones that abort a whole import on a plain object.
    const run = {
      tool: {driver: {name: 'evil', rules: [
        {id: 'constructor', properties: {tags: ['CWE-79']},
          defaultConfiguration: {level: 'error'}},
        {id: '__proto__', properties: {tags: ['CWE-79']},
          defaultConfiguration: {level: 'error'}}
      ]}},
      results: [result('constructor', '__proto__', 'error'), result('__proto__', 'a.js', 'error')]
    };
    const entries = collectRunSourceRefs(run, 'evil')['CWE-79'];
    expect(entries.length).toEqual(2);
    expect(({}).polluted).toBeUndefined();
  });

  it('returns an empty map for a run with no results at all', () => {
    expect(collectRunSourceRefs(null, 'semgrep')).toEqual({});
    expect(collectRunSourceRefs({tool: {driver: {name: 'x'}}, results: []}, 'x')).toEqual({});
  });
});

describe('#129 finalizeSourceRefs - deterministic order and the disclosed cap', () => {
  it('sorts by ruleId, then uri, then violations -> warnings -> notes', () => {
    const entries = [
      {tool: 't', ruleId: 'b', uri: 'z.js', level: 'note', count: 1},
      {tool: 't', ruleId: 'a', uri: 'b.js', level: 'note', count: 1},
      {tool: 't', ruleId: 'a', uri: 'b.js', level: 'error', count: 1},
      {tool: 't', ruleId: 'a', uri: 'a.js', level: 'warning', count: 1},
      {tool: 't', ruleId: 'a', uri: 'b.js', level: 'warning', count: 1}
    ];
    const {sourceRefs} = finalizeSourceRefs(entries);
    expect(sourceRefs.map((entry) => [entry.ruleId, entry.uri, entry.level])).toEqual([
      ['a', 'a.js', 'warning'],
      ['a', 'b.js', 'error'],
      ['a', 'b.js', 'warning'],
      ['a', 'b.js', 'note'],
      ['b', 'z.js', 'note']
    ]);
  });

  it('does not mutate the array it is handed', () => {
    const entries = [
      {tool: 't', ruleId: 'b', uri: 'z.js', level: 'note', count: 1},
      {tool: 't', ruleId: 'a', uri: 'a.js', level: 'note', count: 1}
    ];
    finalizeSourceRefs(entries);
    expect(entries[0].ruleId).toEqual('b');
  });

  it('reports the untruncated total and stores the first CAP entries (AC12)', () => {
    const entries = [];
    for (let i = 0; i < 3241; i += 1) {
      // Zero-padded so plain `<` ordering is the numeric one and the assertion
      // below can name the boundary entry exactly.
      entries.push({tool: 'semgrep', ruleId: 'r', uri: 'src/f' + String(i).padStart(5, '0') + '.js',
        level: 'error', count: 1});
    }
    const shape = finalizeSourceRefs(entries);
    expect(shape.sourceRefsTotal).toEqual(3241);
    expect(shape.sourceRefsTruncated).toBe(true);
    expect(shape.sourceRefs.length).toEqual(SOURCE_REFS_MAX);
    expect(shape.sourceRefs[0].uri).toEqual('src/f00000.js');
    expect(shape.sourceRefs[SOURCE_REFS_MAX - 1].uri).toEqual('src/f00999.js');
  });

  it('is not truncated exactly at the cap', () => {
    const entries = [];
    for (let i = 0; i < SOURCE_REFS_MAX; i += 1) {
      entries.push({tool: 't', ruleId: 'r', uri: 'f' + i, level: 'error', count: 1});
    }
    const shape = finalizeSourceRefs(entries);
    expect(shape.sourceRefsTruncated).toBe(false);
    expect(shape.sourceRefsTotal).toEqual(SOURCE_REFS_MAX);
  });

  it('handles an empty list', () => {
    expect(finalizeSourceRefs([]))
      .toEqual({sourceRefs: [], sourceRefsTotal: 0, sourceRefsTruncated: false});
  });
});

describe('#129 planCweRisks - AC6, AC7, AC8', () => {
  const plan = planOf([{tool: 'semgrep', run: semgrepRun()}]);

  it('produces exactly one Risk per distinct weakness and no others (AC6)', () => {
    expect(plan.tools.length).toEqual(1);
    expect(plan.tools[0].tool).toEqual('semgrep');
    expect(plan.tools[0].risks.map((risk) => risk.cwe))
      .toEqual(['CWE-22', 'CWE-23', 'CWE-36', 'CWE-78', 'CWE-79']);
  });

  it('carries the autoKey and the generated name on every Risk (AC7, AC13)', () => {
    plan.tools[0].risks.forEach((risk) => {
      expect(risk.autoKey).toEqual('sarif-cwe|' + MODULE_ID + '|semgrep|' + risk.cwe);
      expect(risk.name).toEqual('[' + risk.cwe + '] Weakness reported by Semgrep');
    });
  });

  it('lists every key of the tool for the stale sweep', () => {
    expect(plan.tools[0].keys.slice().sort())
      .toEqual(plan.tools[0].risks.map((risk) => risk.autoKey).slice().sort());
  });

  it('gives a rule tagged with three CWEs a place in three Risks (AC8)', () => {
    ['CWE-22', 'CWE-23', 'CWE-36'].forEach((cwe) => {
      const risk = riskFor(plan, 'semgrep', cwe);
      expect(risk.sourceRefs.map((entry) => entry.ruleId)).toEqual([RULE_C, RULE_C]);
      expect(risk.sourceRefsTotal).toEqual(2);
    });
    // ...and the same rule is not smeared over the other weaknesses.
    expect(riskFor(plan, 'semgrep', 'CWE-79').sourceRefs
      .every((entry) => entry.ruleId === RULE_A)).toBe(true);
  });

  it('keeps every occurrence of the busiest weakness', () => {
    const risk = riskFor(plan, 'semgrep', 'CWE-79');
    expect(risk.sourceRefs).toEqual([
      {tool: 'semgrep', ruleId: RULE_A, uri: 'src/app/index.js', level: 'error', count: 1},
      {tool: 'semgrep', ruleId: RULE_A, uri: 'src/app/render.js', level: 'error', count: 3},
      {tool: 'semgrep', ruleId: RULE_A, uri: 'src/app/reply.js', level: 'error', count: 2}
    ]);
    expect(risk.sourceRefsTruncated).toBe(false);
  });

  it('drops nothing on a well-formed document', () => {
    expect(plan.dropped).toEqual({noTool: 0, toolTooLong: 0, overCweCap: 0,
      overToolCap: 0, overImportCap: 0});
  });
});

describe('#129 planCweRisks - AC9: the level never decides whether a Risk exists', () => {
  it('plans the same weaknesses whether every finding is an error, a warning or a note', () => {
    const asError = planOf([{tool: 'semgrep', run: semgrepRun('error')}]);
    const asWarning = planOf([{tool: 'semgrep', run: semgrepRun('warning')}]);
    const asNote = planOf([{tool: 'semgrep', run: semgrepRun('note')}]);
    const cwes = (plan) => plan.tools[0].risks.map((risk) => risk.cwe);
    expect(cwes(asWarning)).toEqual(cwes(asError));
    expect(cwes(asNote)).toEqual(cwes(asError));
    // Same occurrence structure too - only the recorded level differs.
    const shape = (plan) => plan.tools[0].risks.map((risk) =>
      risk.sourceRefs.map((entry) => [entry.ruleId, entry.uri, entry.count]));
    expect(shape(asWarning)).toEqual(shape(asError));
    expect(shape(asNote)).toEqual(shape(asError));
    expect(asNote.tools[0].risks[0].sourceRefs[0].level).toEqual('note');
  });
});

describe('#129 planCweRisks - AC11: byte-identical between modules and between runs', () => {
  it('produces identical sourceRefs for the same document in two modules', () => {
    const one = planOf([{tool: 'semgrep', run: semgrepRun()}], 'aaaaaaaaaaaaaaaaa');
    const two = planOf([{tool: 'semgrep', run: semgrepRun()}], 'bbbbbbbbbbbbbbbbb');
    const refs = (plan) => JSON.stringify(plan.tools.map((entry) =>
      entry.risks.map((risk) => risk.sourceRefs)));
    expect(refs(two)).toEqual(refs(one));
    // Only the identity key differs.
    expect(two.tools[0].risks[0].autoKey).not.toEqual(one.tools[0].risks[0].autoKey);
  });

  it('does not depend on the order the results arrive in', () => {
    const forward = semgrepRun();
    const backward = semgrepRun();
    backward.results.reverse();
    expect(JSON.stringify(planOf([{tool: 'semgrep', run: forward}])))
      .toEqual(JSON.stringify(planOf([{tool: 'semgrep', run: backward}])));
  });
});

describe('#129 planCweRisks - AC16 / AC17: same tool unions, different tools do not', () => {
  const xssRule = {id: 'xss', properties: {tags: ['CWE-79: Cross-site Scripting']},
    defaultConfiguration: {level: 'error'}};

  function xssRun(driver, uri) {
    return {
      tool: {driver: {name: driver, rules: [xssRule]}},
      results: [result('xss', uri, 'error')]
    };
  }

  it('unions two runs of the same tool into one Risk (AC16)', () => {
    const plan = planOf([
      {tool: 'semgrep', run: xssRun('semgrep', 'a.js')},
      {tool: 'Semgrep', run: xssRun('Semgrep', 'b.js')}
    ]);
    expect(plan.tools.length).toEqual(1);
    expect(plan.tools[0].risks.length).toEqual(1);
    expect(plan.tools[0].risks[0].sourceRefs.map((entry) => entry.uri)).toEqual(['a.js', 'b.js']);
  });

  it('adds the counts when both runs report the same triple', () => {
    const plan = planOf([
      {tool: 'semgrep', run: xssRun('semgrep', 'a.js')},
      {tool: 'semgrep', run: xssRun('semgrep', 'a.js')}
    ]);
    expect(plan.tools[0].risks[0].sourceRefs).toEqual([
      {tool: 'semgrep', ruleId: 'xss', uri: 'a.js', level: 'error', count: 2}
    ]);
  });

  it('keeps two tools apart, each with only its own occurrences (AC17)', () => {
    const plan = planOf([
      {tool: 'semgrep', run: xssRun('semgrep', 'a.js')},
      {tool: 'CodeQL', run: xssRun('CodeQL', 'b.js')}
    ]);
    expect(plan.tools.map((entry) => entry.tool)).toEqual(['codeql', 'semgrep']);
    expect(riskFor(plan, 'semgrep', 'CWE-79').sourceRefs.map((entry) => entry.uri)).toEqual(['a.js']);
    expect(riskFor(plan, 'codeql', 'CWE-79').sourceRefs.map((entry) => entry.uri)).toEqual(['b.js']);
    expect(riskFor(plan, 'codeql', 'CWE-79').autoKey)
      .toEqual('sarif-cwe|' + MODULE_ID + '|codeql|CWE-79');
  });
});

describe('#129 planCweRisks - what it refuses to plan', () => {
  const xssRun = {
    tool: {driver: {rules: [{id: 'xss', properties: {tags: ['CWE-79']},
      defaultConfiguration: {level: 'error'}}]}},
    results: [result('xss', 'a.js', 'error')]
  };

  it('plans nothing for a run whose driver publishes no name', () => {
    const plan = planOf([{tool: undefined, run: xssRun}]);
    expect(plan.tools).toEqual([]);
    expect(plan.dropped.noTool).toEqual(1);
  });

  it('falls back to the run driver name when the stored tool field is empty', () => {
    const named = {tool: {driver: {name: 'CodeQL', rules: xssRun.tool.driver.rules}},
      results: xssRun.results};
    const plan = planOf([{tool: '', run: named}]);
    expect(plan.tools.map((entry) => entry.tool)).toEqual(['codeql']);
    expect(plan.dropped.noTool).toEqual(0);
  });

  it('plans nothing for an oversized driver name', () => {
    const plan = planOf([{tool: 'x'.repeat(201), run: xssRun}]);
    expect(plan.tools).toEqual([]);
    expect(plan.dropped.toolTooLong).toEqual(1);
  });

  it('plans nothing for a driver name whose escaped key would not fit', () => {
    // Inside the 200-character tool cap, but escaping triples it, so no key for
    // this tool could be stored. Dropped up front rather than failing inside the
    // insert for every weakness it publishes.
    const plan = planOf([{tool: '%'.repeat(200), run: xssRun}]);
    expect(plan.tools).toEqual([]);
    expect(plan.dropped.toolTooLong).toEqual(1);
  });

  it('caps the number of Risks one tool can mint in one import', () => {
    const rules = [];
    const results = [];
    for (let i = 1; i <= CWE_RISKS_MAX_PER_TOOL + 25; i += 1) {
      rules.push({id: 'r' + i, properties: {tags: ['CWE-' + i]},
        defaultConfiguration: {level: 'error'}});
      results.push(result('r' + i, 'f.js', 'error'));
    }
    const plan = planOf([{tool: 'semgrep', run: {tool: {driver: {name: 'semgrep', rules}}, results}}]);
    expect(plan.tools[0].risks.length).toEqual(CWE_RISKS_MAX_PER_TOOL);
    expect(plan.dropped.overCweCap).toEqual(25);
    // Kept by ascending CWE number, so which 200 survive is deterministic.
    expect(plan.tools[0].risks[0].cwe).toEqual('CWE-1');
    expect(plan.tools[0].risks[CWE_RISKS_MAX_PER_TOOL - 1].cwe)
      .toEqual('CWE-' + CWE_RISKS_MAX_PER_TOOL);
  });

  // --- added with the security fix round (major finding 1) ------------------

  // Builds one run per distinct driver name, each publishing `cwes` weaknesses.
  // This is the shape TestImportsCreate produces from a multi-run SARIF document:
  // one tool BUCKET per run.
  function manyTools(toolCount, cwes) {
    const documents = [];
    for (let t = 0; t < toolCount; t += 1) {
      const rules = [];
      const results = [];
      for (let i = 1; i <= cwes; i += 1) {
        rules.push({id: 'r' + i, properties: {tags: ['CWE-' + i]},
          defaultConfiguration: {level: 'error'}});
        results.push(result('r' + i, 'f.js', 'error'));
      }
      const name = 'tool-' + String(t).padStart(4, '0');
      documents.push({tool: name, run: {tool: {driver: {name, rules}}, results}});
    }
    return documents;
  }

  it('caps the number of TOOL BUCKETS one import can open', () => {
    const plan = planOf(manyTools(60, 1));
    expect(plan.tools.length).toEqual(CWE_RISK_MAX_TOOLS);
    expect(plan.dropped.overToolCap).toEqual(60 - CWE_RISK_MAX_TOOLS);
    // Sorted first, so WHICH tools survive is a property of the document rather
    // than of the order its runs happened to arrive in.
    expect(plan.tools.map((entry) => entry.tool))
      .toEqual(plan.tools.map((entry) => entry.tool).slice().sort());
    expect(plan.tools[0].tool).toEqual('tool-0000');
  });

  // The regression security explicitly asked for: the existing cap test only
  // exercises ONE tool, so it passed all the way through the 12,000-risk
  // reproduction. This one asserts the TOTAL across every bucket.
  it('caps the TOTAL number of Risks one import can plan, across all tools', () => {
    const plan = planOf(manyTools(60, CWE_RISKS_MAX_PER_TOOL));
    const total = plan.tools.reduce((sum, bucket) => sum + bucket.risks.length, 0);
    expect(total).toEqual(CWE_RISKS_MAX_PER_IMPORT);
    // Without the caps this document plans 60 x 200 = 12,000.
    expect(total).toBeLessThan(12000);
    expect(plan.dropped.overToolCap).toEqual(60 - CWE_RISK_MAX_TOOLS);
    expect(plan.dropped.overImportCap).toBeGreaterThan(0);
    // Disclosed, not silent - the same contract the other two caps already have.
    expect(plan.dropped.overToolCap + plan.dropped.overImportCap +
      plan.dropped.overCweCap).toBeGreaterThan(0);
  });

  it('protects a capped-out weakness from the stale sweep instead of emptying it', () => {
    // The keys list is what the sweep does NOT touch. A weakness the document
    // really does report has to stay in it whether or not the budget left room
    // to write it - otherwise hitting the cap would clear the evidence of the
    // very risks it declined to refresh.
    const plan = planOf(manyTools(4, 200));
    const planned = plan.tools.reduce((sum, bucket) => sum + bucket.risks.length, 0);
    const keys = plan.tools.reduce((sum, bucket) => sum + bucket.keys.length, 0);
    expect(planned).toEqual(CWE_RISKS_MAX_PER_IMPORT);
    expect(keys).toEqual(800);
    expect(new Set(plan.tools.reduce((all, b) => all.concat(b.keys), [])).size).toEqual(800);
  });

  it('caps a rule id and a file path where the entry is built', () => {
    const longRule = 'r'.repeat(SOURCE_REF_RULE_ID_MAX + 500);
    const longUri = 'd/'.repeat(SOURCE_REF_URI_MAX);
    const run = {
      tool: {driver: {name: 'semgrep', rules: [{id: longRule, properties: {tags: ['CWE-79']},
        defaultConfiguration: {level: 'error'}}]}},
      results: [result(longRule, longUri, 'error')]
    };
    const entry = planOf([{tool: 'semgrep', run}]).tools[0].risks[0].sourceRefs[0];
    expect(entry.ruleId.length).toEqual(SOURCE_REF_RULE_ID_MAX);
    expect(entry.uri.length).toEqual(SOURCE_REF_URI_MAX);
    expect(longUri.startsWith(entry.uri)).toBe(true);
  });

  it('aggregates on the CAPPED values, so two entries never hold the same string', () => {
    // If the triple key were built from the raw values, two paths differing only
    // past the cap would be two entries with byte-identical stored uris.
    const rules = [{id: 'r', properties: {tags: ['CWE-79']},
      defaultConfiguration: {level: 'error'}}];
    const base = 'a'.repeat(SOURCE_REF_URI_MAX);
    const run = {tool: {driver: {name: 'semgrep', rules}},
      results: [result('r', base + 'ONE', 'error'), result('r', base + 'TWO', 'error')]};
    const refs = planOf([{tool: 'semgrep', run}]).tools[0].risks[0].sourceRefs;
    expect(refs.length).toEqual(1);
    expect(refs[0].count).toEqual(2);
    expect(refs[0].uri.length).toEqual(SOURCE_REF_URI_MAX);
  });

  // Rec 2: the segment is stored on its own as riskProperties.autoTool (max 200)
  // as well as inside the key. Escaping can triple a name, so a ~250-character
  // segment used to pass the key check on a short moduleId and then fail
  // collection2 INSIDE insertRisk - on every import, forever, with only a
  // console.error and nothing at all produced for that tool.
  it('plans nothing for a tool whose ESCAPED segment overflows autoTool', () => {
    // 90 `%` escape to 270 characters: inside the 200-char raw tool cap, and the
    // assembled key (10 + 17 + 270 + 20 + 3 = 320)... is also over AUTO_KEY_MAX,
    // so use a short module id to isolate the autoTool bound.
    const shortModule = 'm';
    const plan = planCweRisks({moduleId: shortModule, documents: [{tool: '%'.repeat(90),
      run: {tool: {driver: {rules: [{id: 'x', properties: {tags: ['CWE-79']},
        defaultConfiguration: {level: 'error'}}]}},
      results: [result('x', 'a.js', 'error')]}}]});
    expect(toolKeySegment('%'.repeat(90)).length).toEqual(270);
    expect(270).toBeGreaterThan(AUTO_TOOL_MAX);
    // The key alone would have fitted: 'sarif-cwe|m|<270>|CWE-79' is 289 <= 300.
    expect(buildAutoKey(shortModule, toolKeySegment('%'.repeat(90)), 'CWE-79')).not.toBeNull();
    expect(plan.tools).toEqual([]);
    expect(plan.dropped.toolTooLong).toEqual(1);
  });

  it('escapes the moduleId segment the same way it escapes the tool segment', () => {
    // Not exploitable - no Meteor _id contains `%` or `|` - but leaving one of
    // the two variable segments unescaped is a boundary a later change could
    // make forgeable.
    expect(buildAutoKey('a|b', 'semgrep', 'CWE-79'))
      .toEqual('sarif-cwe|a%7Cb|semgrep|CWE-79');
    expect(buildAutoKey('a|b', 'semgrep', 'CWE-79'))
      .not.toEqual(buildAutoKey('a', 'b|semgrep', 'CWE-79'));
    // ...and it is the identity for every id that can actually reach it.
    expect(buildAutoKey(MODULE_ID, 'semgrep', 'CWE-79'))
      .toEqual('sarif-cwe|' + MODULE_ID + '|semgrep|CWE-79');
  });

  it('plans nothing without a moduleId, and nothing for an empty document list', () => {
    expect(planOf([{tool: 'semgrep', run: xssRun}], '').tools).toEqual([]);
    expect(planOf([]).tools).toEqual([]);
    expect(planCweRisks({}).tools).toEqual([]);
    expect(planCweRisks().tools).toEqual([]);
  });

  it('skips a document whose run is not an object rather than throwing', () => {
    const plan = planOf([{tool: 'semgrep', run: null}, {tool: 'semgrep', run: xssRun}]);
    expect(plan.tools[0].risks.length).toEqual(1);
  });

  it('still lists a tool that published no weakness this time, so the sweep runs', () => {
    // AC24's other half: a tool whose newest scan reports nothing has to empty
    // the occurrence lists its previous scan created. Dropping the bucket here
    // would leave those risks showing evidence that no longer exists.
    const clean = {
      tool: {driver: {name: 'Bandit', rules: [
        {id: 'B104', helpUri: 'https://bandit.readthedocs.io/en/1.7.4/plugins/b104.html'}
      ]}},
      results: [result('B104', 'app.py', 'error')]
    };
    const plan = planOf([{tool: 'Bandit', run: clean}]);
    expect(plan.tools).toEqual([{tool: 'bandit', keys: [], risks: []}]);
  });
});

describe('describeDropped (#30)', () => {
  const {describeDropped} = require('../../imports/lib/sarif/cweRiskPlan');

  it('is null when nothing was dropped', () => {
    expect(describeDropped({noTool: 2, toolTooLong: 1, overCweCap: 0, overToolCap: 0, overImportCap: 0})).toBeNull();
    expect(describeDropped(undefined)).toBeNull();
  });

  it('names the dropped tools and weaknesses with the limits', () => {
    expect(describeDropped({overToolCap: 2, overCweCap: 5, overImportCap: 1}))
      .toBe('Risks were not created for 2 tools beyond the first 8 and 6 weaknesses beyond ' +
        'the limit of 200 per tool and 400 per import.');
    expect(describeDropped({overToolCap: 1})).toBe('Risks were not created for 1 tool beyond the first 8.');
    expect(describeDropped({overImportCap: 1}))
      .toBe('Risks were not created for 1 weakness beyond the limit of 200 per tool and 400 per import.');
  });

  it('is part of the plan for a document over the tool cap', () => {
    const {planCweRisks} = require('../../imports/lib/sarif/cweRiskPlan');
    const documents = Array.from({length: 10}, (v, i) => ({
      tool: `tool-${i}`,
      run: {tool: {driver: {name: `tool-${i}`}}, results: []}
    }));
    const plan = planCweRisks({moduleId: 'm1', documents});
    expect(describeDropped(plan.dropped)).toContain('2 tools beyond the first 8');
  });
});
