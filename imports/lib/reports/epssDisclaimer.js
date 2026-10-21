// Shared EPSS disclaimer copy for the vulnerability report's CVSS vs EPSS scatter
// chart. Defined once here so both the on-screen scatter component
// (imports/client/ui/reports/report-vulnerability/report-vulnerability-scatter.js)
// and the PDF export (imports/lib/reports/reportVulnerabilityService.js) reference
// the exact same string - never pasted twice.
export const EPSS_DISCLAIMER_TEXT = 'EPSS is a snapshot, not a fixed rating - scores are recalculated regularly ' +
  'and can rise sharply as real-world exploitation activity changes, even for CVEs that look low-risk today. ' +
  'It is a probability estimate, not a guarantee of what will or won\'t be exploited, so treat it as one input ' +
  'among several (alongside CVSS and business context) when prioritizing remediation.';
