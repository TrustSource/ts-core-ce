// Canonical risk-origin enum + UI option list + allowed-origin guard.
// CommonJS and dependency-free so the Jest harness can require it without
// Meteor, and so the schema (allowedValues) and the client UI dropdown share
// a single source of truth.
//
// `RISK_ORIGIN_VALUES` is the schema enum used by RiskSchema's `origin` field
// (it includes '' so blank UI/clean() paths stay valid). `RISK_ORIGIN_OPTIONS`
// drives the edit-modal dropdown (no '' option - the blank choice is rendered
// by the template). `threat-model` is the legacy value the TM agent shipped
// before `TMA Assessment` existed; it is kept (last) so editing a stored
// threat-model risk doesn't drop its origin. 'LIC' is inserted
// BEFORE it for the same reason - threat-model has to stay last.
const RISK_ORIGIN_VALUES = ['', 'SDLC', 'SQ', 'SSC', 'CVE', 'YARA', 'CWE', 'TD', 'TMA Assessment', 'LIC',
  'threat-model'];

const RISK_ORIGIN_OPTIONS = [
  {value: 'SDLC', label: 'Software Development Lifecycle (SDLC)'},
  {value: 'SQ', label: 'Software/Code Quality (SQ)'},
  {value: 'SSC', label: 'Software Supply Chain (SSC)'},
  {value: 'CVE', label: 'Vulnerability (CVE)'},
  {value: 'YARA', label: 'Malware (YARA)'},
  {value: 'CWE', label: 'Assessment (CWE), weaknesses from risk or sec assessments'},
  {value: 'TD', label: 'Technical Debt (TD) , e.g. old versions'},
  {value: 'TMA Assessment', label: 'Threat Model Assessment (TMA)'},
  {value: 'LIC', label: 'Unmatched License (LIC)'},  // A license a compliance manager set manually
  {value: 'threat-model', label: 'Threat Model (legacy)'}  // last; kept so editing a stored threat-model risk doesn't drop the origin
];

function isAllowedOrigin(v) {
  return RISK_ORIGIN_VALUES.indexOf(v) !== -1;
}

module.exports = {RISK_ORIGIN_VALUES, RISK_ORIGIN_OPTIONS, isAllowedOrigin};
