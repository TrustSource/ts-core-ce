/* global Promise:false */
import _ from 'underscore';
import { nanoid } from 'nanoid'
import {Meteor} from 'meteor/meteor';
import {moment} from 'meteor/momentjs:moment';
import Companies from '/imports/lib/collections/companies';
import Utils from '/imports/lib/utils';
import {Config} from '/imports/config';
import {sortKeys} from './sortKeys';

// import {Validator} from 'jsonschema';
// keep in mind that external reverences like https://www.first.org/cvss/cvss-v2.0.json are removed
// import CSAF_SCHEMA from '/public/schemas/csaf_json_schema.json';

// This module is bundled to the BROWSER (three client files import it), so it must
// hold no key material and compute no product_id. Every `product_id` it renders is
// handed in by its caller: server callers use imports/server/csaf/productId
// in-process, client callers fetch tokens over CSAF.EncodeModuleIds.

// THE CONFIDENCE FLOOR THE PUBLIC VEX FEED APPLIES.
//
// The release-key feed (companies.js `publicVexKey.getFile`) passes this value
// to fromVulnerabilityReport. Declared once so no future caller can drift from
// it.
//
// Deliberately NOT resolved from the project's own confidenceMinScore: the
// in-app views do that, but a published advisory should not change shape because
// someone moved a slider in project settings.
const PUBLIC_VEX_CONFIDENCE = 4;

const VEX = {
  fromVulnerabilityReport: fromVulnerabilityReport,
  moduleToProductVersion: moduleToProductVersion,
  vulnerabilityToCVE: vulnerabilityToCVE
};

export default VEX;

// sortKeys is re-exported (test-only) from the meteor-free helper module so unit
// tests can require it without pulling in Meteor.
export {sortKeys};

// The floor the public VEX feed applies; see the constant above.
export {PUBLIC_VEX_CONFIDENCE};

function toPurl(module) {
  if (!module || !module.key) return null;
  const key = module.key;
  const version = module.version || '';
  const idx = key.indexOf(':');
  if (idx === -1) return null;
  const type = key.slice(0, idx).toLowerCase();
  const rest = key.slice(idx + 1);
  const versionPart = version ? `@${encodeURIComponent(version)}` : '';
  switch(type) {
  case 'npm':
    return `pkg:npm/${rest}${versionPart}`;
  case 'mvn':
  case 'maven': {
    const parts = rest.split(':');
    if (parts.length >= 2) return `pkg:maven/${parts[0]}/${parts[1]}${versionPart}`;
    return null;
  }
  case 'pypi':
  case 'pip':
  case 'py':
    return `pkg:pypi/${rest}${versionPart}`;
  case 'nuget':
    return `pkg:nuget/${rest}${versionPart}`;
  case 'gem':
  case 'rubygems':
    return `pkg:gem/${rest}${versionPart}`;
  case 'cargo':
    return `pkg:cargo/${rest}${versionPart}`;
  case 'composer':
    return `pkg:composer/${rest}${versionPart}`;
  case 'golang':
  case 'go':
  case 'gomod':
    return `pkg:golang/${rest}${versionPart}`;
  default:
    return null;
  }
}

function extractCweName(res) {
  if (!res || !res.data) return null;
  const d = res.data;
  // Try known shapes: {1: {name}}, {name}, {data: {name}}, {cwes: [{name}]}
  if (d[1] && d[1].name) return d[1].name;
  if (d.name) return d.name;
  if (d.data && d.data.name) return d.data.name;
  if (Array.isArray(d.cwes) && d.cwes[0] && d.cwes[0].name) return d.cwes[0].name;
  if (Array.isArray(d) && d[0] && d[0].name) return d[0].name;
  return null;
}

async function fetchCweNames(weaknessIds, companyId) {
  const map = {};
  const unique = _.uniq(_.compact(weaknessIds));
  await Promise.all(unique.map(wid => new Promise((resolve) => {
    // Skip NVD pseudo-ids (NVD-CWE-Other, NVD-CWE-noinfo) and anything that
    // doesn't look like "CWE-<number>" - the lake only knows real MITRE ids.
    if (!/^CWE-\d+$/i.test(wid)) {
      resolve();
      return;
    }
    const numeric = wid.substring(wid.indexOf('-') + 1);
    Meteor.call('tsVulnerabilityCweDetails', numeric, companyId, (err, res) => {
      if (!err) {
        const name = extractCweName(res);
        if (name) map[wid] = name;
      }
      resolve();
    });
  })));
  return map;
}

async function moduleToProductVersion(module, productId) {
  if (typeof productId !== 'string' || productId === '') {
    throw new Error('VEX: missing product_id for module');
  }
  return {
    category: 'product_version',
    name: module.version || (module.analysis && (module.analysis.release || module.analysis.tag ||
      (module.analysis.date && `${moment(module.analysis.date).toISOString()}`))) || productId,
    product: {
      name: module.name,
      product_id: productId
    }
  }
}

// https://docs.oasis-open.org/csaf/csaf/v2.0/cs02/csaf-v2.0-cs02.html
async function fromVulnerabilityReport({company, project, modules, list}, confidenceCurrent, createCSAF, productIds) {
  // `productIds` is a {moduleId: token} map supplied by the caller. Validated as a
  // whole up front, so a missing token fails the generation loudly instead of
  // emitting `product_id: undefined` into a published advisory.
  if (!productIds || typeof productIds !== 'object') {
    throw new Error('VEX: productIds map is required');
  }
  _.forEach(modules, (module) => {
    const token = module && productIds[module._id];
    if (typeof token !== 'string' || token === '') {
      throw new Error('VEX: missing product_id for module');
    }
  });
  if(!company && project.companyId){
    company = Companies.findOne(project.companyId)
  }
  const originalData = _.clone(list);
  const filteredData = originalData.filter((vuln)=>{
    const score = vuln.problems.vulnerability && vuln.problems.vulnerability[0].extra.confidence
    return confidenceMap(score) >= confidenceCurrent
  })
  let branchesModules = _.map(modules, (module)=>{
    const moduleId = productIds[module._id];
    const product = {
      name: module.name,
      product_id: moduleId
    }
    const purl = toPurl(module);
    if (purl) {
      product.product_identification_helper = { purl };
    } else {
      // No purl: identify the module by its page on this installation.
      product.product_identification_helper = {
        x_generic_uris: [{
          namespace: Config.appUrl,
          uri: `${Config.appUrl}module/${encodeURIComponent(moduleId)}`
        }]
      };
    }
    return {
      category: 'product_version',
      name: module.version || (module.analysis && (module.analysis.release || module.analysis.tag ||
        (module.analysis.date && `${moment(module.analysis.date).toISOString()}`) || moduleId)),
      product
    }
  })
  const year = new Date().getFullYear()
  const draftPrefix = (company && company.csafPrefixVex) || 'tsvx';
  let id = `${draftPrefix}-${year}-${nanoid(10)}`;
  const today = new Date();
  let root = {
    document: {
      category: 'csaf_vex',
      csaf_version: '2.0',
      lang: 'en',
      distribution: {
        tlp: {
          label: 'WHITE',
          url: 'https://www.first.org/tlp/'
        }
      },
      notes: [
        {
          category: 'summary',
          text: 'Detailed list of project vulnerabilities',
          title: 'Author comment'
        }
      ],
      // The company that owns the project publishes the advisory from this installation.
      publisher: {
        category: 'vendor',
        name: (company && company.name) || Config.name,
        namespace: Config.appUrl
      },
      references: [
        {
          category: 'self',
          summary: 'Canonical URL',
          url: `${Config.appUrl}csaf/json/${encodeURIComponent(id)}.json`
        }
      ],
      title: 'Project CSAF document',
      tracking: {
        current_release_date: `${today.toISOString()}`,
        generator: {
          date: `${today.toISOString()}`,
          engine: {
            name: Config.name,
            version: Config.version
          }
        },
        id,
        initial_release_date: `${today.toISOString()}`,
        revision_history: [
          {
            'date': `${today.toISOString()}`,
            'number': '1',
            'summary': 'Initial version.'
          }
        ],
        status: 'final',
        version: '1'
      }
    },
    product_tree: {
      branches: [
        {
          branches: [
            {
              branches: branchesModules,
              category: 'product_name',
              name: project && project.name || 'Project details n/a. Please regenerate report'
            }
          ],
          category: 'vendor',
          name: company && company.name || 'Company details n/a. Please regenerate report'
        }
      ]
    }
  };
  let cveIds = [];
  _.forEach(filteredData, function (component) {
    _.forEach(component.problems.vulnerability, function (vulnerability) {
      cveIds.push(vulnerability.key);
    });
  });
  const cvesDetails = await new Promise((resolve, reject) =>
    Meteor.call('tsVulnerabilityCveDetails', {cves: cveIds}, company._id, function (error, result) {
      if (error) return reject(error);
      if(result && result.data && result.data.cves){
        resolve(result.data.cves)
      } else {
        resolve([])
      }
    })
  );
  const cweMap = await fetchCweNames(cvesDetails.map(c => c && c.weakness), company._id);
  const cvesByKey = new Map(cvesDetails.map(c => [c && c.cve_id, c]));
  const vulnsByKey = new Map();
  _.forEach(filteredData, function (component) {
    _.forEach(component.problems.vulnerability, function (vulnerability) {
      const key = vulnerability.key;
      const cveDetail = cvesByKey.get(key);
      const existing = vulnsByKey.get(key);
      if (!existing) {
        if (!root.vulnerabilities) root.vulnerabilities = [];
        const next = vulnerabilityToCVE(vulnerability, component, cveDetail, productIds, null, cweMap);
        root.vulnerabilities.push(next);
        vulnsByKey.set(key, next);
      } else {
        addVulnerabilityIfNotAvailable(existing, vulnerabilityToCVE(vulnerability, component, cveDetail, productIds, null, cweMap));
      }
    });
  });
  // if(root.vulnerabilities && root.vulnerabilities.length != stats.vulnerability){
  //   console.log('Internal error: VEX.fromVulnerabilityReport - generated vulnerabilities are not same as stats')
  // }
  // validate against schema https://docs.oasis-open.org/csaf/csaf/v2.0/os/schemas/
  // const v = new Validator();
  // const validity = v.validate(root, CSAF_SCHEMA)
  // console.log(validity)
  if (root.vulnerabilities && root.vulnerabilities.length) {
    const referenced = new Set();
    root.vulnerabilities.forEach(v => {
      if (v.product_status) {
        Object.values(v.product_status).forEach(arr => (arr || []).forEach(id => referenced.add(id)));
      }
      (v.remediations || []).forEach(r => (r.product_ids || []).forEach(id => referenced.add(id)));
      (v.threats || []).forEach(t => (t.product_ids || []).forEach(id => referenced.add(id)));
      (v.scores || []).forEach(s => (s.products || []).forEach(id => referenced.add(id)));
    });
    const filtered = branchesModules.filter(b => referenced.has(b.product.product_id));
    if (filtered.length) {
      root.product_tree.branches[0].branches[0].branches = filtered;
    }
  }
  root = sortKeys(root);
  if(createCSAF){
    const apiUser = Meteor.user()
    await new Promise((resolve, reject) => {
      Meteor.call('CSAF.Create', {file: root, companyId: company._id, name: `${id}.json`, apiUser}, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  return root
}

const addVulnerabilityIfNotAvailable = function (cve, vulnerability) {
  if(cve && cve.threats && cve.threats[0] && cve.threats[0].product_ids &&
    vulnerability && vulnerability.threats && vulnerability.threats[0] && vulnerability.threats[0].product_ids){
    cve.threats[0].product_ids = _.uniq([...cve.threats[0].product_ids, vulnerability.threats[0].product_ids])
  }
};

function buildReferences(details) {
  let references = details && details.references ? _.map(details.references, (reference) => {
    return {
      'category': 'external',
      'summary': reference.tags && reference.tags.length ? reference.tags.join(' - ') : 'Third Party Advisory',
      'url': reference.url
    }
  }) : []
  if (references.length > 1) {
    const byUrl = new Map();
    references.forEach(r => {
      const prev = byUrl.get(r.url);
      if (!prev || (r.summary && r.summary.length > (prev.summary || '').length)) byUrl.set(r.url, r);
    });
    references = Array.from(byUrl.values());
  }
  if (!references.length) {
    references.push({
      'category': 'external',
      'summary': 'Third Party Advisory',
      'url': `${Config.appUrl}vulnerability_lake`
    })
  }
  return references
}

function buildScores(details, product_ids, extra) {
  const scores = []
  const impact = Utils.groupedImpactVersions(details && details.impact)
  if(details && impact && impact.cvss2 && impact.cvss2.baseScore){
    scores.push({cvss_v2: impact.cvss2, products: product_ids})
  }
  if(details && impact && impact.cvss3 && impact.cvss3.baseScore){
    scores.push({cvss_v3: impact.cvss3, products: product_ids})
  }
  // CSAF 2.0 schema allows only cvss_v2/cvss_v3 under scores[]. Re-enable when CSAF 2.1 support lands.
  if(!scores.length){
    scores.push({
      cvss_v2: {
        version: '2.0',
        vectorString: 'AV:N/AC:L/Au:N/C:N/I:P/A:N',
        baseScore: extra && extra.score ? +extra.score : extra.severity || 5
      },
      products: product_ids
    })
  }
  return scores
}

function vulnerabilityToCVE(vulnerability, component, details, cryptoMap, productIds, cweMap) {
  let {key, extra, isWhitelisted} = vulnerability
  let {paths} = component
  // _.compact: a path may point at a module outside the generated set, and an
  // unmapped lookup would otherwise inject `undefined` into product_status /
  // remediations / threats / scores while never appearing in the product_tree.
  //
  // hasOwnProperty, not a bare read: a moduleId of `toString` / `constructor` /
  // `valueOf` would otherwise resolve up the prototype chain to a FUNCTION, which
  // is truthy enough to survive _.compact and serialises to `null` in a published
  // advisory - a product_status entry referring to no branch at all.
  let product_ids = productIds || _.uniq(_.compact(_.map(paths, (path) =>
    (path && cryptoMap && Object.prototype.hasOwnProperty.call(cryptoMap, path.moduleId)
      ? cryptoMap[path.moduleId] : undefined))))
  const references = buildReferences(details)
  const scores = buildScores(details, product_ids, extra)
  // mitigation - information about a configuration or deployment scenario that helps to reduce the risk of the vulnerability
  //    but that does not resolve the vulnerability on the affected product
  // no_fix_planned - for the vulnerability and it is not planned to provide one at any time
  // none_available - indicates that there is currently no fix or other remediation available
  // vendor_fix - official fix that is issued by the original author of the affected product
  // workaround - a configuration or specific deployment scenario that can be used to avoid exposure to the vulnerability
  let remediations
  // Preset, customer-safe remediation `details` strings. The mute `comment` is an internal field
  // (it carries the muting admin's name and date) and must never be redistributed in the published
  // CSAF. We use the comment ONLY to detect the product_status / remediation category below.
  const VEX_DETAILS = {
    no_fix_planned: 'Risk accepted by customer',
    workaround: 'Mitigation provided by customer'
  }
  // first_affected - represents that these are the first versions of the releases known to be affected by the vulnerability
  // first_fixed - represents that these versions contain the first fix for the vulnerability but may not be the recommended fixed versions
  // fixed - represents that these versions contain a fix for the vulnerability but may not be the recommended fixed versions.
  // known_affected - represents that these versions are known to be affected by the vulnerability. Actions are recommended to
  //    remediate or address this vulnerability.
  // known_not_affected - represents that these versions are known not to be affected by the vulnerability. No remediation is required
  //    regarding this vulnerability.
  // last_affected - represents that these are the last versions in a release train known to be affected by the vulnerability
  // recommended - represents that these versions have a fix for the vulnerability and are the vendor-recommended versions for fixing
  // under_investigation - represents that it is not known yet whether these versions are or are not affected by the vulnerability.
  //    However, it is still under investigation - the result will be provided in a later release of the document.
  let product_status = {}
  const whitelistComment = (isWhitelisted && isWhitelisted.comment) || ''
  if(!isWhitelisted && product_ids && product_ids.length){
    product_status.under_investigation = product_ids
    if(!remediations){
      remediations = []
    }
    remediations.push({
      category: 'none_available',
      details: 'Investigation in progress',
      product_ids
    })
  }else if(isWhitelisted){
    if(whitelistComment.indexOf('False positive, not applicable to us') > -1 ||
      whitelistComment.indexOf('Vulnerable code not in use') > -1){
      product_status.known_not_affected = product_ids
    }else if(whitelistComment.indexOf('Risk is tolerable, won\'t fix') > -1){
      product_status.known_affected = product_ids
      if(!remediations){
        remediations = []
      }
      remediations.push({
        category: 'no_fix_planned',
        details: VEX_DETAILS.no_fix_planned,
        product_ids
      })
    }else if(whitelistComment.indexOf('Fix is about to be implemented') > -1 ||
      whitelistComment.indexOf('Fix has been provided') > -1){
      product_status.fixed = product_ids
    }else{
      product_status.known_affected = product_ids
      if(!remediations){
        remediations = []
      }
      remediations.push({
        category: 'workaround',
        details: VEX_DETAILS.workaround,
        product_ids
      })
    }
  }
  // exploit_status - contains a description of the degree to which an exploit for the vulnerability is known
  // impact - contains an assessment of the impact on the user or the target set if the vulnerability is successfully exploited or
  //    a description why it cannot be exploited
  // target_set - contains a description of the currently known victim population in whatever terms are appropriate
  let threats
  if(whitelistComment && (product_status.known_affected || product_status.known_not_affected)){
    // Strip trailing " By <user>, <date>" suffix; only emit a threats entry if there is meaningful text left.
    const parts = whitelistComment.split(' By ')
    if(parts.length > 1){
      parts.pop()
      const threatDetails = parts.join(' By ')
      if(threatDetails){
        if(!threats){
          threats = []
        }
        threats.push({
          category: product_status.known_not_affected ? 'impact' : 'exploit_status',
          details: threatDetails,
          product_ids
        })
      }
    }
  }
  if(product_status && product_status.fixed){
    scores.forEach(function(score){
      if(score.cvss_v3){
        const baseVector = (score.cvss_v3.vectorString || '').replace(/\/M[CIA]:[XNLH]/g, '')
        score.cvss_v3 = Object.assign({}, score.cvss_v3, {
          modifiedAvailabilityImpact: 'NONE',
          modifiedConfidentialityImpact: 'NONE',
          modifiedIntegrityImpact: 'NONE',
          environmentalScore: 0,
          environmentalSeverity: 'NONE',
          vectorString: baseVector + '/MC:N/MI:N/MA:N'
        })
      }
      if(score.cvss_v2){
        const baseV2 = (score.cvss_v2.vectorString || '').replace(/\/(CDP|TD|CR|IR|AR):[A-Z]+/g, '')
        score.cvss_v2 = Object.assign({}, score.cvss_v2, {
          collateralDamagePotential: 'NONE',
          targetDistribution: 'NONE',
          confidentialityRequirement: 'NOT_DEFINED',
          integrityRequirement: 'NOT_DEFINED',
          availabilityRequirement: 'NOT_DEFINED',
          environmentalScore: 0,
          vectorString: baseV2 + '/CDP:N/TD:N/CR:ND/IR:ND/AR:ND'
        })
      }
    })
  }
  if(!Object.keys(product_status).length){
    product_status = undefined
  }
  let cwe
  if(details && details.weakness && cweMap && cweMap[details.weakness]){
    cwe = {
      id: details.weakness,
      name: cweMap[details.weakness]
    }
  }
  let generalData = {
    notes: [
      {
        'category': 'description',
        'text': details && details.description ? details.description : 'Descriptions is not available',
        'title': 'CVE description'
      }
    ],
    product_status,
    references,
    remediations,
    scores,
    cwe,
    threats
  }
  if(key.match(/^CVE-\d{4}-\d{4,}$/)){
    generalData.cve = key
  }else{
    generalData.ids = [{
      system_name: 'Internal Advisory',
      text: key
    }]
  }
  return Utils.removeEmpty(generalData)
}

function confidenceMap(score) {
  if (score) {
    if (score === 5) {
      return 1
    } else if (score === 4) {
      return 2
    } else if (score === 2) {
      return 4
    } else if (score === 1) {
      return 5
    } else {
      return score
    }
  }
  return 5;
}
