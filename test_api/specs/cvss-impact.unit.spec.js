// The component index detail page showed "n/a" for every CVSS score, even after
// "Get details" had fetched the full record. The tsVulnerabilityCveDetails
// response carries no flat score field - the score lives inside `impact` - and
// Vulnerability.getScore() only ever read the flat field. Everywhere else the
// score survived because the page already had one from the local Cves
// collection.
//
// The fixtures below are trimmed copies of real tsVulnerabilityCveDetails
// responses for CVE-2022-25844 and GHSA-2vrf-hf26-jrp5, after
// Utils.groupedImpactVersions has normalised `cvss31` to `cvss3`.
const {impactScore, impactVector} = require('../../imports/lib/component/cvssImpact');

// CVE-2022-25844: scored under both CVSS 2 and CVSS 3.1.
const CVE_IMPACT = {
  cvss2: {baseScore: 5, vectorString: 'AV:N/AC:L/Au:N/C:N/I:N/A:P', version: '2.0'},
  cvss2_exploitscore: 10,
  cvss2_impactscore: 2.9,
  cvss3: {
    baseScore: 5.3,
    baseSeverity: 'MEDIUM',
    vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L',
    version: '3.1'
  },
  cvss3_exploitscore: 3.9,
  cvss3_impactscore: 1.4
};

// GHSA-2vrf-hf26-jrp5: CVSS 3 only.
const GHSA_IMPACT = {
  cvss3: {baseScore: 5.3, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L', version: '3.1'},
  cvss3_exploitscore: 5.3,
  cvss3_impactscore: 5.3
};

describe('impactScore', () => {
  it('reads the score out of a single-version impact', () => {
    expect(impactScore(GHSA_IMPACT)).toBe(5.3);
  });

  it('prefers the highest CVSS version when a finding is scored more than once', () => {
    expect(impactScore(CVE_IMPACT)).toBe(5.3);
    expect(impactScore({cvss2: {baseScore: 5}, cvss3: {baseScore: 7.5}, cvss4: {baseScore: 9.8}})).toBe(9.8);
    expect(impactScore({cvss2: {baseScore: 5}, cvss3: {baseScore: 7.5}})).toBe(7.5);
    expect(impactScore({cvss2: {baseScore: 5}})).toBe(5);
  });

  it('skips a version that carries a vector but no score', () => {
    expect(impactScore({cvss4: {vectorString: 'CVSS:4.0/AV:N'}, cvss3: {baseScore: 7.5}})).toBe(7.5);
  });

  it('returns undefined when there is nothing to read', () => {
    expect(impactScore(undefined)).toBeUndefined();
    expect(impactScore(null)).toBeUndefined();
    expect(impactScore({})).toBeUndefined();
    // exploit/impact sub-scores are not base scores
    expect(impactScore({cvss3_exploitscore: 3.9, cvss3_impactscore: 1.4})).toBeUndefined();
  });
});

describe('impactVector', () => {
  it('reads the vector of the same version the score came from', () => {
    expect(impactVector(CVE_IMPACT)).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L');
    expect(impactVector({cvss2: {vectorString: 'AV:N/AC:L/Au:N/C:N/I:N/A:P'}}))
      .toBe('AV:N/AC:L/Au:N/C:N/I:N/A:P');
  });

  it('returns undefined when there is nothing to read', () => {
    expect(impactVector(undefined)).toBeUndefined();
    expect(impactVector({})).toBeUndefined();
  });
});
