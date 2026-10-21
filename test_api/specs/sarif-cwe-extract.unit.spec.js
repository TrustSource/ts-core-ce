/* eslint-disable no-undef*/
// SARIF findings had to expose their CWE ids per module, next to
// the CVEs already reported per module.
//
// Every fixture below is copied from a real SARIF document (CodeQL, semgrep,
// Bandit, and Microsoft's CweGhasSample), not invented - the awkward shapes are
// the whole reason this module exists.
//
// cweExtract.js is meteor-free CommonJS so Jest can require it directly, the
// same dual-consumption pattern as runStatus.js and findingSummary.js.
const {normalizeCwe, extractRuleCwes, collectRunCwes} = require('../../imports/lib/sarif/cweExtract');

describe('#126 normalizeCwe - one spelling for an id written five ways', () => {
  it('accepts the forms the tools actually emit', () => {
    // CodeQL tag path, semgrep tag prefix, a bare id, and the lower-case and
    // colon spellings the vulnerability-lake search already had to learn.
    expect(normalizeCwe('external/cwe/cwe-079')).toEqual('CWE-79');
    expect(normalizeCwe('CWE-601: URL Redirection to Untrusted Site')).toEqual('CWE-601');
    expect(normalizeCwe('cwe-89')).toEqual('CWE-89');
    expect(normalizeCwe('CWE:22')).toEqual('CWE-22');
    expect(normalizeCwe('CWE 1220')).toEqual('CWE-1220');
  });

  it('strips CodeQL zero padding so ids match everywhere else in TrustSource', () => {
    // CodeQL pads to three digits. Left alone, "CWE-022" matches no key in
    // cweVulnType.js's table and no CWE the CVE side of the DFD viewer renders,
    // so the pill would silently never join up.
    expect(normalizeCwe('external/cwe/cwe-022')).toEqual('CWE-22');
    expect(normalizeCwe('external/cwe/cwe-099')).toEqual('CWE-99');
    // The same query set also emits unpadded ids, so both have to land together.
    expect(normalizeCwe('external/cwe/cwe-79')).toEqual('CWE-79');
  });

  it('returns null rather than guessing', () => {
    [null, undefined, '', 'security', 'OWASP-A01:2021 - Broken Access Control',
      'external/cwe/cwe-', 'CWE-', 42, {}].forEach((input) => {
      expect(normalizeCwe(input)).toBeNull();
    });
  });
});

describe('#126 extractRuleCwes - where the tools actually put the CWE', () => {
  it('reads CodeQL external/cwe tags, including multi-CWE rules', () => {
    // py/path-injection, verbatim from a CodeQL run: one rule, five weaknesses.
    const rule = {
      id: 'py/path-injection',
      properties: {
        tags: ['correctness', 'security', 'external/cwe/cwe-022', 'external/cwe/cwe-023',
          'external/cwe/cwe-036', 'external/cwe/cwe-073', 'external/cwe/cwe-099'],
        'security-severity': '7.5'
      }
    };
    expect(extractRuleCwes(rule)).toEqual(['CWE-22', 'CWE-23', 'CWE-36', 'CWE-73', 'CWE-99']);
  });

  it('reads the semgrep tag form, ignoring the OWASP and category tags beside it', () => {
    const rule = {
      id: 'typescript.nestjs.security.audit.nestjs-open-redirect',
      properties: {
        tags: ["CWE-601: URL Redirection to Untrusted Site ('Open Redirect')",
          'OWASP-A01:2021 - Broken Access Control', 'security'],
        precision: 'very-high'
      }
    };
    expect(extractRuleCwes(rule)).toEqual(['CWE-601']);
  });

  it('reads properties.cwe, which newer semgrep uses instead of tags', () => {
    // Semgrep OSS emits no `tags` at all on this shape; Snyk Code is the same.
    // A tags-only reader returns nothing for these documents.
    const rule = {
      id: 'javascript.express.security.audit.xss.direct-response-write',
      properties: {
        cwe: ['CWE-79: Improper Neutralization of Input During Web Page Generation'],
        vulnerability_class: ['Cross-Site Scripting (XSS)'],
        category: 'security'
      }
    };
    expect(extractRuleCwes(rule)).toEqual(['CWE-79']);
  });

  it('accepts properties.cwe given as a bare string', () => {
    expect(extractRuleCwes({id: 'r', properties: {cwe: 'CWE-89'}})).toEqual(['CWE-89']);
  });

  it('reads the formal SARIF taxonomy relationship when a tool uses it', () => {
    const rule = {
      id: 'SQLI',
      relationships: [{target: {id: 'CWE-89', toolComponent: {name: 'CWE'}}}]
    };
    expect(extractRuleCwes(rule)).toEqual(['CWE-89']);
  });

  it('takes only the leading id of a tag, never the ones quoted in its prose', () => {
    // flawfinder-style tags name the weakness first and then discuss others in
    // the description. A global scan turns that prose into a CWE the tool never
    // asserted - exactly the guessing the extractor rules out.
    expect(extractRuleCwes({id: 'r', properties: {
      tags: ['CWE-120: Does not check for buffer overflows (CWE-120, CWE-20)']
    }})).toEqual(['CWE-120']);

    expect(extractRuleCwes({id: 'r', properties: {
      tags: ['CWE-22: chroot can be very helpful, but is hard to use correctly (CWE-250)']
    }})).toEqual(['CWE-22']);

    expect(extractRuleCwes({id: 'r', properties: {
      tags: ['CWE-120: Statically-sized arrays can be improperly restricted (CWE-119!/CWE-120)']
    }})).toEqual(['CWE-120']);
  });

  it('de-duplicates ids reached by different spellings', () => {
    expect(extractRuleCwes({id: 'r', properties: {
      cwe: ['CWE-79'],
      tags: ['external/cwe/cwe-079', 'CWE-79: Cross-site Scripting']
    }})).toEqual(['CWE-79']);
  });

  it('returns an empty list for a rule with no resolvable CWE', () => {
    // Bandit ships no properties at all; Trivy tags severity words. Neither may
    // be guessed at from the rule id or the helpUri.
    expect(extractRuleCwes({id: 'B104', name: 'hardcoded_bind_all_interfaces',
      helpUri: 'https://bandit.readthedocs.io/en/1.7.4/plugins/b104.html'})).toEqual([]);
    expect(extractRuleCwes({id: 'AVD-AZU-0014',
      properties: {tags: ['misconfiguration', 'security', 'MEDIUM']}})).toEqual([]);
    expect(extractRuleCwes(null)).toEqual([]);
  });

  it('survives the non-string tag entries semgrep has been known to emit', () => {
    // semgrep/semgrep#4673: owasp/cwe metadata leaked into `tags` as arrays,
    // which is invalid SARIF but did ship.
    expect(extractRuleCwes({id: 'r', properties: {
      tags: [['CWE-79'], null, 7, 'external/cwe/cwe-089']
    }})).toEqual(['CWE-89']);
  });
});

describe('#126 collectRunCwes - per-level counts for one stored run', () => {
  // A run mixing CWE-tagged and untagged rules, which is the mixed document the
  // ticket asks to be covered.
  const MIXED_RUN = {
    tool: {driver: {name: 'semgrep', rules: [
      {id: 'xss', properties: {tags: ['CWE-79: Cross-site Scripting']},
        defaultConfiguration: {level: 'error'}},
      {id: 'sqli', properties: {tags: ['CWE-89: SQL Injection']},
        defaultConfiguration: {level: 'error'}},
      {id: 'style', properties: {tags: ['maintainability']},
        defaultConfiguration: {level: 'note'}}
    ]}},
    results: [
      {ruleId: 'xss'}, {ruleId: 'xss'}, {ruleId: 'xss'},
      {ruleId: 'sqli'},
      {ruleId: 'style'}, {ruleId: 'style'}
    ]
  };

  // `ruleIds` was added later: each entry names the rules that put findings
  // under the weakness, which is what lets cweMappingOverlay tell a weakness the
  // tool published for a rule from one a human assigned to the same rule, and so
  // stop counting those findings twice. The counts themselves are unchanged.
  it('counts findings per CWE per level', () => {
    expect(collectRunCwes(MIXED_RUN)).toEqual({
      'CWE-79': {violations: 3, warnings: 0, notes: 0, ruleIds: ['xss']},
      'CWE-89': {violations: 1, warnings: 0, notes: 0, ruleIds: ['sqli']}
    });
  });

  it('leaves rules without a CWE out entirely', () => {
    // `style` fired twice and is absent, rather than present with a zero or a
    // placeholder id.
    const byCwe = collectRunCwes(MIXED_RUN);
    expect(Object.keys(byCwe).sort()).toEqual(['CWE-79', 'CWE-89']);
  });

  it('counts a multi-CWE rule once under each of its weaknesses', () => {
    // One finding, five CWEs: the per-CWE counts deliberately sum to more than
    // the number of findings.
    const run = {
      tool: {driver: {rules: [{id: 'py/path-injection',
        properties: {tags: ['external/cwe/cwe-022', 'external/cwe/cwe-023']},
        defaultConfiguration: {level: 'error'}}]}},
      results: [{ruleId: 'py/path-injection'}]
    };
    expect(collectRunCwes(run)).toEqual({
      'CWE-22': {violations: 1, warnings: 0, notes: 0, ruleIds: ['py/path-injection']},
      'CWE-23': {violations: 1, warnings: 0, notes: 0, ruleIds: ['py/path-injection']}
    });
  });

  it('finds rules CodeQL hosts in tool.extensions rather than the driver', () => {
    // Current CodeQL leaves driver.rules empty and ships the catalog - and so
    // every CWE tag - in an extension. Reading only the driver returns nothing
    // for the single biggest emitter of CWE tags.
    const run = {
      tool: {
        driver: {name: 'CodeQL', rules: []},
        extensions: [{name: 'codeql/python-queries', rules: [
          {id: 'py/command-line-injection',
            properties: {tags: ['security', 'external/cwe/cwe-078', 'external/cwe/cwe-088']},
            defaultConfiguration: {level: 'error'}}
        ]}]
      },
      results: [{ruleId: 'py/command-line-injection',
        rule: {id: 'py/command-line-injection', index: 0, toolComponent: {index: 0}}}]
    };
    expect(collectRunCwes(run)).toEqual({
      'CWE-78': {violations: 1, warnings: 0, notes: 0, ruleIds: ['py/command-line-injection']},
      'CWE-88': {violations: 1, warnings: 0, notes: 0, ruleIds: ['py/command-line-injection']}
    });
  });

  it('counts a finding whose level neither the result nor the rule states', () => {
    // SARIF 2.1.0 §3.27.10: with `kind` absent (so "fail"), a missing level
    // means "warning". Bandit states no level anywhere.
    const run = {
      tool: {driver: {name: 'Bandit', rules: [
        {id: 'B602', properties: {tags: ['CWE-78: OS Command Injection']}}
      ]}},
      results: [{ruleId: 'B602', ruleIndex: 0}]
    };
    expect(collectRunCwes(run))
      .toEqual({'CWE-78': {violations: 0, warnings: 1, notes: 0, ruleIds: ['B602']}});
  });

  it('ignores results that are not failures', () => {
    const run = {
      tool: {driver: {rules: [{id: 'x', properties: {tags: ['CWE-79']}}]}},
      results: [{ruleId: 'x', kind: 'pass'}, {ruleId: 'x', kind: 'informational'}]
    };
    expect(collectRunCwes(run)).toEqual({});
  });

  it('returns an empty map for a run with no results or no catalog', () => {
    expect(collectRunCwes({tool: {driver: {rules: []}}, results: []})).toEqual({});
    expect(collectRunCwes({tool: {driver: {name: 'x'}}, results: [{ruleId: 'a'}]})).toEqual({});
    expect(collectRunCwes(null)).toEqual({});
  });
});
