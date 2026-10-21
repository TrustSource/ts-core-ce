import {
  BWLicenseEntrySchema,
  BWComponentEntrySchema,
  BWCveEntrySchema,
  BWObligationEntrySchema,
  BWLegalRulesEntrySchema
} from './bwlistSchema';
import {RequirementsSchema} from './requirementsProjectSchema';
import {CIARequirementsSchema} from './CIARequirementsSchema';
import {AlgorithmsConfig} from './algorithmsSchema';
import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import {EndoflifePolicy} from './endoflifePolicySchema';

// Shared client/server cap for the "Application goals" / architecture.md upload.
// Both imports/lib/interactors/projects/updateArchitecture.js and
// imports/server/rest-api/projects.js (backend-dev) and project-settings.js
// (frontend-dev, client-side pre-check) import this from here per the
// Interface Contract - kept as a single named export so both sides stay in sync.
// It is a SIZE cap only, enforced by SimpleSchema on every write path that
// touches this field.
export const PROJECT_DESCRIPTION_MAX = 100 * 1024;

const ProjectLicenseConfig = new SimpleSchema({
  whitelist: {
    type: [BWLicenseEntrySchema]
  },
  blacklist: {
    type: [BWLicenseEntrySchema]
  }
});

const ProjectCveConfig = new SimpleSchema({
  whitelist: {
    type: [BWCveEntrySchema]
  },
  blacklist: {
    type: [BWCveEntrySchema]
  }
});

const ProjectComponentConfig = new SimpleSchema({
  whitelist: {
    type: [BWComponentEntrySchema]
  },
  blacklist: {
    type: [BWComponentEntrySchema]
  },
  unchanged: {
    type: [BWComponentEntrySchema]
  },
  looseCoupled: {
    type: [BWComponentEntrySchema]
  }
});

const ProjectJiraSettings = new SimpleSchema({
  url: {
    type: String,
    optional: true,
    regEx: SimpleSchema.RegEx.Url
  },
  user: {
    type: String,
    optional: true
  },
  passwd: {
    type: String,
    optional: true
  },
  key: {
    type: String,
    optional: true
  },
  type: {
    type: String,
    optional: true
  },
  email: {
    type: String,
    optional: true
  },
  active: {
    type: Boolean
  }
});

const ProjectTfsSettings = new SimpleSchema({
  account: {
    type: String
  },
  project: {
    type: String
  },
  token: {
    type: String
  },
  active: {
    type: Boolean
  }
});

const ProjectGithubSettings = new SimpleSchema({
  token: {
    type: String
  },
  repository: {
    type: String
  },
  active: {
    type: Boolean
  }
});

const ReleaseConfig = new SimpleSchema({
  name: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    optional: true
  },
  approved: {
    type: Boolean,
    optional: true
  },
  initiated: {
    type: Boolean,
    optional: true
  },
  date: {
    type: Date
  },
  initiator: {
    type: String,
    optional: true,
    regEx: SimpleSchema.RegEx.Id
  },
  initiatorName: {
    type: String,
    optional: true
  },
  assignment: {
    type: String,
    optional: true,
    regEx: SimpleSchema.RegEx.Id
  },
  assignmentName: {
    type: String,
    optional: true
  }
});

const RelatedUsersSettings = new SimpleSchema({
  defaultProjectManager: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select default project manager',
        allowClear: false
      }
    }
  },
  defaultComplianceManager: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true,
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select default compliance manager',
        allowClear: false
      }
    }
  },
  members: {
    type: Array,
    optional: true,
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select members',
        allowClear: true,
        multiple: true,
        tags: true
      }
    }
  },
  'members.$': {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  followers: {
    type: Array,
    optional: true,
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select followers',
        allowClear: true,
        multiple: true,
        tags: true
      }
    }
  },
  'followers.$': {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  pinnedBy: {
    type: Array,
    optional: true,
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select users, that want pin this project',
        allowClear: true,
        multiple: true,
        tags: true
      }
    }
  },
  'pinnedBy.$': {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  }
});

export const ProjectSchema = new SimpleSchema({
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
  creationDate: {
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
  description: {
    type: String,
    label: 'Application goals',
    optional: true,
    max: PROJECT_DESCRIPTION_MAX,
    autoform: {
      type: 'textarea'
    }
  },
  leanix: {
    type: String,
    label: 'Link with LeanIX',
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select LeanIX Fact Sheet',
        allowClear: true
      }
    },
    optional: true
  },
  jira: {
    type: ProjectJiraSettings,
    optional: true
  },
  tfs: {
    type: ProjectTfsSettings,
    optional: true
  },
  github: {
    type: ProjectGithubSettings,
    optional: true
  },
  licenseConfig: {
    type: ProjectLicenseConfig,
    optional: true
  },
  componentConfig: {
    type: ProjectComponentConfig,
    optional: true
  },
  cveConfig: {
    type: ProjectCveConfig,
    optional: true
  },
  obligationConfig: {
    type: [BWObligationEntrySchema],
    optional: true
  },
  legalRulesConfig: {
    type: [BWLegalRulesEntrySchema],
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  },
  release: {
    label: 'Release',
    type: [ReleaseConfig],
    optional: true
  },
  requireWhitelist: {
    label:'Require allow',
    type: Boolean,
    optional: true
  },
  relatedUsers: {
    type: RelatedUsersSettings,
    optional: true
  },
  tags: {
    type: Array,
    optional: true,
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select tags',
        allowClear: true,
        multiple: true,
        tags: true
      }
    }
  },
  'tags.$': {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  requirements: {
    type: RequirementsSchema,
    optional: true
  },
  ciaRequirements: {
    type: CIARequirementsSchema,
    optional: true
  },
  // MDR/IVDR classification was removed; kept only because existing project documents still carry this field.
  classification:{
    type: Object,
    optional: true,
    blackbox: true
  },
  confidenceMinScore: {
    type: String,
    optional: true,
    label: 'Default confidence level',
    allowedValues: ['1', '4', '5'],
    autoform: {
      type: 'select',
      options: [
        {label: 'High only', value: '5'},
        {label: 'Medium +', value: '4'},
        {label: 'All', value: '1'}
      ]
    }
  },
  algorithmsConfig: {
    type: [AlgorithmsConfig],
    optional: true
  },
  endoflifePolicy: {
    type: EndoflifePolicy,
    optional: true
  },
  // Opt-in: each SARIF import for a module in this project keeps one
  // risk per (tool, CWE) in the risk register. Default OFF, and OFF is spelled
  // "absent": deliberately NO defaultValue, because ProjectSchema.clean() runs on
  // the plain document in helpers.cleanAndValidateProject, so a defaultValue is
  // applied on the REST POST path to every project the API touches. Silently switching a customer's risk
  // register on is exactly what this toggle exists to prevent, so every read is a
  // strict `=== true`.
  autoCreateCweRisks: {
    type: Boolean,
    optional: true,
    label: 'Create risks from SARIF weaknesses (CWE)'
  },
  // The vulnerability-alert SETTINGS live on the webhook row
  // (imports/lib/schemas/webhookSchema.js), not here: they only ever qualify the
  // two vulnerability triggers, and a company-global receiver needs to state its
  // own scope across every project. What remains on the project is the sweep's
  // bookkeeping stamp below.
  //
  // No defaultValue, for the same reason autoCreateCweRisks has none:
  // ProjectSchema.clean() runs on the plain document in
  // helpers.cleanAndValidateProject, so a defaultValue is applied on the REST
  // POST path to every project the API touches.
  //
  // Sweep bookkeeping, never a user setting: the round-robin cursor that keeps a
  // company with more opted-in projects than one batch served fairly.
  vulnerabilityAlertSweptAt: {
    type: Date,
    optional: true
  }
});
