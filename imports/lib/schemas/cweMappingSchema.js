import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import {CWE_MAPPING_MAX_CWES, CWE_MAPPING_RULE_ID_MAX, CWE_MAPPING_TOOL_MAX} from '/imports/lib/sarif/cweMappingOverlay';

// One weakness a human assigned to a rule the scanning tool left unclassified.
//
// `companyId` present  -> a candidate, applying only inside that company.
// `companyId` absent   -> a global default, applying to every company that has
//                         no candidate of its own for the same (tool, ruleId).
//
// ts-app only ever writes candidates. Promoting one to a global default affects
// every other customer, so it belongs to a TrustSource-internal role in
// ts-app-admin, against this same collection - which is why the shape carries
// `status` from day one rather than needing a migration later.
export const CweMappingSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  companyId: {
    type: String,
    optional: true
  },
  // The SARIF driver name as stored on the test document, lower-cased. A rule id
  // is only unique within its tool.
  tool: {
    type: String,
    min: 1,
    max: CWE_MAPPING_TOOL_MAX
  },
  // Raw and unescaped. The '.' -> '___' escaping the import applies to use a rule
  // id as a Mongo key is one-way, so the readable form is what is kept here and
  // the overlay escapes both sides of the lookup instead.
  ruleId: {
    type: String,
    min: 1,
    max: CWE_MAPPING_RULE_ID_MAX
  },
  // The bounds are shared with the set/remove interactors, which enforce them
  // before doing any work proportional to the input - schema validation only
  // runs at insert, which is too late to protect the event loop.
  cwes: {
    type: [String],
    minCount: 1,
    maxCount: CWE_MAPPING_MAX_CWES
  },
  'cwes.$': {
    type: String,
    regEx: /^CWE-\d+$/
  },
  status: {
    type: String,
    allowedValues: ['candidate', 'global']
  },
  created: {
    type: Date,
    optional: true
  },
  edited: {
    type: Date,
    optional: true
  },
  createdBy: {
    type: String,
    optional: true
  },
  userName: {
    type: String,
    optional: true
  }
});
