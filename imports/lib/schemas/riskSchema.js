import {SimpleSchema} from 'meteor/aldeed:simple-schema';
// Canonical risk-origin enum/options live in a pure CommonJS module so they can
// be shared with the Jest harness and the client UI dropdown (single source of
// truth). Re-export them here so the UI can import from this schema module.
import {RISK_ORIGIN_VALUES, RISK_ORIGIN_OPTIONS} from '/imports/lib/interactors/riskProperties/riskOrigin';
// Same reason: the four states a SARIF import must never write to
// live in a pure CommonJS module the Jest harness and the server writer share.
import {UNTOUCHED_RISK_STATES} from '/imports/lib/interactors/riskProperties/managedFields';

export {RISK_ORIGIN_VALUES, RISK_ORIGIN_OPTIONS, UNTOUCHED_RISK_STATES};

// Shared enum sources - used for schema validation (allowedValues) and UI dropdowns.
// '' is included so the blank dropdown option stays valid on paths that skip clean().
export const RISK_STATE_VALUES = ['', 'identified', 'assessed', 'approved', 'planned',
  'implementing', 'monitored', 'accepted', 'closed', 'deferred', 'escalated', 'expired',
  'transferred', 'eliminated', 'out-of-scope'];

// States that count as "this risk is dealt with" in the list views, the tiles and
// the portfolio treemap (green there). One array, since separate literals is how
// the views drifted apart in the first place.
export const RESOLVED_RISK_STATES = ['accepted', 'closed', 'eliminated', 'transferred', 'out-of-scope'];

// Open and overdue: postponed (`deferred`) or an acceptance that ran out
// (`expired`). Counted as open in the tiles and shown red in the treemap; every
// other open state is shown as a warning there.
export const OVERDUE_RISK_STATES = ['deferred', 'expired'];

// The open states the treemap shows as a warning.
export const OPEN_RISK_WARNING_STATES = RISK_STATE_VALUES.filter(function (state) {
  return state && RESOLVED_RISK_STATES.indexOf(state) === -1 && OVERDUE_RISK_STATES.indexOf(state) === -1;
});

export const COUNTERMEASURE_STATUS_VALUES = ['', 'identified', 'planned', 'completed', 'ok',
  'required', 'not-required', 'verified'];

// The STRIDE categories a threat model context may name, as the dropdown shows them.
export const STRIDE_CATEGORIES = ['Spoofing', 'Tampering', 'Repudiation',
  'Information Disclosure', 'Denial of Service', 'Elevation of Privilege'];

/**
 * A STRIDE category in its canonical spelling ('information disclosure' ->
 * 'Information Disclosure'); anything else is returned unchanged for validation
 * to refuse.
 */
export function normalizeStrideCategory(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const match = STRIDE_CATEGORIES.find((category) => category.toLowerCase() === value.trim().toLowerCase());
  return match || value;
}

export const CountermeasureSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  countermeasure: {
    type: String,
    // eslint-disable-next-line sonarjs/regex-complexity
    regEx: [/^[^<>]*$/, /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/],
    min: 3,
    max: 200
  },
  status: {
    type: String,
    optional: true,
    allowedValues: COUNTERMEASURE_STATUS_VALUES
  },
  comment: {
    type: String,
    optional: true
  },
  responsible: {
    type: [String],
    optional: true
  },
  riskReduction: {
    type: Number,
    optional: true,
    min: 0,
    max: 100
  },
  standardRef: {
    type: String,
    optional: true,
    max: 200
  },
  validationMethod: {
    type: String,
    optional: true,
    max: 200
  },
  otmMitigationId: {
    type: String,
    optional: true,
    max: 200
  }
})

const ThreatModelContextSchema = new SimpleSchema({
  strideCategories: {
    type: [String],
    optional: true
  },
  'strideCategories.$': {
    type: String,
    allowedValues: STRIDE_CATEGORIES,
    // 'information disclosure' is stored as 'Information Disclosure'.
    autoValue: function () {
      if (this.isSet) {
        return normalizeStrideCategory(this.value);
      }
    }
  },
  enisaCategory: {
    type: String,
    optional: true,
    max: 200
  },
  enisaThreat: {
    type: String,
    optional: true,
    max: 300
  },
  cwes: {
    type: [String],
    optional: true
  },
  affectedElementType: {
    type: String,
    optional: true,
    max: 100
  },
  trustBoundaryCrossing: {
    type: Boolean,
    optional: true
  },
  tmRunId: {
    type: String,
    optional: true,
    max: 200
  },
  tmMethod: {
    type: String,
    optional: true,
    max: 200
  },
  otmThreatId: {
    type: String,
    optional: true,
    max: 200
  }
})

const RiskPropertiesSchema = new SimpleSchema({
  impactClass: {
    type: String,
    optional: true
  },
  // C/I/A: whether the risk affects confidentiality, integrity, availability (the
  // editor's checkboxes). Stored as booleans; older risks may hold 'true'/'false'.
  confidentiality: {
    type: Boolean,
    optional: true
  },
  generalApproach: {
    type: String,
    optional: true
  },
  integrity: {
    type: Boolean,
    optional: true
  },
  availability: {
    type: Boolean,
    optional: true
  },
  impactDescription: {
    type: String,
    optional: true
  },
  impact: {
    type: String,
    optional: true
  },
  state: {
    type: String,
    optional: true,
    allowedValues: RISK_STATE_VALUES
  },
  BV: {
    type: String,
    optional: true
  },
  BV_enum: {
    type: String,
    optional: true
  },
  EF: {
    type: String,
    optional: true
  },
  EF_enum: {
    type: String,
    optional: true
  },
  ARO: {
    type: String,
    optional: true
  },
  ARO_enum: {
    type: String,
    optional: true
  },
  origin: {
    type: Array,
    optional: true
  },
  'origin.$': {
    type: String,
    allowedValues: RISK_ORIGIN_VALUES
  },
  countermeasures: {
    type: [CountermeasureSchema],
    optional: true
  },
  threatModelContext: {
    type: ThreatModelContextSchema,
    optional: true
  },

  // --- Server-managed: written only by the SARIF reconcile ------
  //
  // `denyUpdate` is a NO-OP in this repo's vendored simple-schema, so these are
  // NOT protected by being declared here. The enforcement is
  // riskProperties/managedFields.js, which strips them out of every modifier
  // reaching RiskProperties.Update and every payload reaching .Create.
  //
  // `autoKey` identifies an auto-managed risk - 'sarif-cwe|<moduleId>|<tool>|
  // <CWE-nnn>' - and carries a unique PARTIAL index (server/collections/
  // riskProperties.js). It is what makes a re-import an update rather than a
  // duplicate, whatever a human has since done to the name, origin or CWE list.
  // A hand-made risk carries none of these fields and is therefore never
  // adopted and never blocked (AC20).
  autoKey: {
    type: String,
    optional: true,
    max: 300
  },
  // Denormalized out of the key so the stale sweep needs no prefix parsing and
  // can ride the existing moduleId index.
  autoTool: {
    type: String,
    optional: true,
    max: 200
  },
  autoCwe: {
    type: String,
    optional: true,
    max: 30,
    regEx: /^CWE-\d+$/
  },
  // The license key the manual resolution most recently recorded for
  // this component, denormalized out of the module document so the reconcile can
  // ask "has anything actually changed?" without reading it back - and so the
  // update branch can tell an auto-written name from one a human has since
  // edited. Bound mirrors SelectedLicensesEntrySchema.key.max / LICENSE_KEY_MAX.
  autoLicense: {
    type: String,
    optional: true,
    max: 100
  },
  // One entry per distinct (ruleId, uri, level) occurrence. Blackbox because the
  // entry shape belongs to cweRiskPlan.js, which is the only thing that writes
  // it; bounded at SOURCE_REFS_MAX with the truncation disclosed rather than
  // silent, because an uncapped array built from an uploaded document is a
  // 16MB-document hazard.
  sourceRefs: {
    type: Array,
    optional: true
  },
  'sourceRefs.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  sourceRefsTotal: {
    type: Number,
    optional: true,
    min: 0
  },
  sourceRefsTruncated: {
    type: Boolean,
    optional: true
  },
  // The N in the detail view's "0 of N findings still active - ready to close?".
  sourceRefsPrevCount: {
    type: Number,
    optional: true,
    min: 0
  }
});


export const RiskSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    denyUpdate: true
  },
  created: {
    type: Date,
    optional: true
  },
  edited: {
    type: Date,
    optional: true
  },
  name: {
    type: String,
    label: 'Name',
    // eslint-disable-next-line sonarjs/regex-complexity
    regEx: [/^[^<>]*$/, /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/],
    min: 3,
    max: 200
  },
  projectId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  moduleId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  userId: {
    type: String,
    optional: true
  },
  userName: {
    type: String,
    optional: true
  },
  riskProperties: {
    type: RiskPropertiesSchema,
    optional: true
  }
});
