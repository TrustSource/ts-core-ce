/* eslint-disable no-useless-escape, no-loss-of-precision */
import {
  BWLicenseEntrySchema,
  BWComponentEntrySchema,
  BWCveEntrySchema,
  BWObligationEntrySchema,
  BWLegalRulesEntrySchema
} from './bwlistSchema';
import {RequirementsSchema} from './requirementsModuleSchema';
import {CommercialTermsSchema} from './commercialTermsSchema';
import {CIARequirementsSchema} from './CIARequirementsSchema';
import {LICENSES_SELECTED_MAX} from '/imports/lib/licenseResolution/resolutionEntry';
import {AlgorithmsConfig} from './algorithmsSchema';
import {ComponentUrlsSchema, ComponentDeepScanSchema} from './componentSchema';
import _ from 'underscore';
import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import Utils from '/imports/lib/utils';
import {EndoflifePolicy} from './endoflifePolicySchema';

const NO_MONITORING = 'no monitoring'
const VERY_LOW_ACTIVITY = 'very low activity'
const LOW_ACTIVITY = 'low activity'
const NORMAL_ACTIVITY = 'normal activity'
const VERY_ACTIVE = 'very active'
const MORE_7 = 'more than 7 behind'
const MORE_4_LESS_6 = '4-6 behind'
const LESS_3 = 'less than 3 behind'
const VIOLATION_TRASH = 'Violation threshold'
const WARNING_TRASH = 'Warning threshold'

const CustomComponentSchema = new SimpleSchema({
  key: {
    type: String,
    min: 1,
    max: 250
  },
  version: {
    type: String,
    min: 1,
    max: 20,
    regEx: /^(?:[A-Za-z0-9_\.-]+|[A-Za-z0-9_\.-]*\*)$/
  },
  comment: {
    type: String,
    min: 1,
    max: 200
  }
});

const ModuleJiraIntegrations = new SimpleSchema({
  jira: {
    type: String
  },
  ecs: {
    type: String
  }
});

const ModuleTfsIntegrations = new SimpleSchema({
  id: {
    type: String
  },
  ecs: {
    type: String
  }
});

const ModuleLicenseConfig = new SimpleSchema({
  whitelist: {
    type: [BWLicenseEntrySchema]
  },
  blacklist: {
    type: [BWLicenseEntrySchema]
  }
});

const ModuleCveConfig = new SimpleSchema({
  whitelist: {
    type: [BWCveEntrySchema]
  },
  blacklist: {
    type: [BWCveEntrySchema]
  }
});

const SelectedLicensesEntrySchema = new SimpleSchema({
  // 250, not the 100 this used to declare, and that is the same
  // whole-class fix `version` got below. This is a COMPONENT key, and every
  // sibling component-key field of the very same componentConfig -
  // BWComponentEntrySchema.key (whitelist/blacklist/unchanged/looseCoupled/
  // changedStatus) and CustomComponentSchema.key - already declares 250. At 100
  // an ordinary long scanner key (`golang:github.com/<org>/<repo>/<deep>/<path>`)
  // written by any of the three writers stored fine (Modules has no attached
  // schema) and then 400ed the next REST module POST supplying componentConfig.
  // Mirrored by COMPONENT_KEY_MAX in imports/lib/licenseResolution/resolutionEntry.js.
  key: {
    type: String,
    min: 1,
    max: 250
  },
  // OPTIONAL, and that is a whole-class fix rather than a new
  // field's convenience: all three writers this app ships - the multi-license
  // modal, applyRootLicense's default-assignment push and the manual license
  // resolution - omit it, because a pick is per (module, component key) and
  // covers every version. apiSchema clean()s componentConfig whenever a REST
  // caller supplies it, so each of them would 400 a module PUT today.
  version: {
    type: String,
    min: 1,
    max: 20,
    regEx: /^(?:[A-Za-z0-9_\.-]+|[A-Za-z0-9_\.-]*\*)$/,
    optional: true
  },
  path: {
    type: String,
    optional: true
  },
  license: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    min: 1,
    max: 200
  },
  // --- Manual license resolution -------------------------------
  //
  // `justification` is the DISCRIMINATOR: only entries carrying it were written
  // by Modules.ResolveComponentLicense, and they alone drive the per-dependency
  // injection into the scan, the "License set manually" panel and undo. A
  // multi-license-modal pick or a root-picker pick for the same component
  // carries none of these four and is therefore never claimed or deleted.
  //
  // Optional, because those two other writers legitimately produce entries
  // without them. The bound mirrors JUSTIFICATION_MAX in
  // imports/lib/licenseResolution/resolutionEntry.js, which is what the method
  // actually enforces - `Modules` has no attached schema, so this declaration
  // only binds the REST module PUT path.
  justification: {
    type: String,
    optional: true,
    max: 2000
  },
  resolvedBy: {
    type: String,
    optional: true,
    max: 200
  },
  resolvedById: {
    type: String,
    optional: true,
    max: 64
  },
  resolvedAt: {
    type: Date,
    optional: true
  }
});

const ModuleComponentConfig = new SimpleSchema({
  whitelist: {
    type: [BWComponentEntrySchema],
    optional: true
  },
  blacklist: {
    type: [BWComponentEntrySchema],
    optional: true
  },
  unchanged: {
    type: [BWComponentEntrySchema],
    optional: true
  },
  looseCoupled: {
    type: [BWComponentEntrySchema],
    optional: true
  },
  // Capped: a resolution entry carries up to 2000 characters of
  // free text plus the author fields, so an uncapped array reaches the 16MB BSON
  // limit and makes the module document unwritable by anything - including the
  // code that would remove the entries. One number, shared with the method that
  // appends (imports/lib/licenseResolution/resolutionEntry.js).
  licensesSelected: {
    type: [SelectedLicensesEntrySchema],
    optional: true,
    maxCount: LICENSES_SELECTED_MAX
  },
  changedStatus: {
    type: [BWComponentEntrySchema],
    optional: true
  }
});

const ModuleUsedLicenses = new SimpleSchema({
  key: {
    type: String,
    optional: true       // maybe null for 'unknown' LicenseType
  },
  name: {
    type: String
  },
  components: {
    type: [String]
  },
  rating: {
    type: Object,
    optional: true
  },
  'rating.ratings': {
    type: [Object],
    blackbox: true
  },
  'rating.totalRating': {
    type: Number
  },
  'rating.holdLiable': {
    type: Number
  },
  'rating.commercialisation': {
    type: Number
  },
  'rating.propertyProtection': {
    type: Number
  },
  incompatibility: {
    type: [String],
    optional: true
  }
});

const ModuleAnalysisStatisticsValues = new SimpleSchema({
  warnings: {
    type: Number,
    defaultValue: 0
  },
  violations: {
    type: Number,
    defaultValue: 0
  }
});

const ModuleAnalysisStatistics = new SimpleSchema({
  licenses: {
    type: Number
  },
  components: {
    type: Number
  },
  legal: {
    type: ModuleAnalysisStatisticsValues
  },
  vulnerability: {
    type: ModuleAnalysisStatisticsValues
  },
  viability: {
    type: ModuleAnalysisStatisticsValues
  },
  versioning: {
    type: ModuleAnalysisStatisticsValues
  },
  integrity: {
    type: ModuleAnalysisStatisticsValues
  },
  analysisId: {
    type: String,
    optional: true
  }
});

const ModuleReferrencedComponentProblem = new SimpleSchema({
  status: {
    type: String,
    allowedValues: ['warnings', 'violations']
  },
  message: {
    type: String
  },
  versions: {
    type: String,
    optional: true
  }
});

const ModuleReferrencedComponent = new SimpleSchema({
  key: {
    type: String
  },
  versions: {
    type: [Object]
  },
  'versions.$.version': {
    type: String
  },
  'versions.$.paths': {
    type: [String]
  },
  status: {
    type: String,
    allowedValues: ['ok', 'warnings', 'violations']
  },
  problems: {
    type: Object,
    optional: true
  },
  'problems.legal': {
    type: [ModuleReferrencedComponentProblem],
    optional: true
  },
  'problems.vulnerability': {
    type: [ModuleReferrencedComponentProblem],
    optional: true
  },
  'problems.viability': {
    type: [ModuleReferrencedComponentProblem],
    optional: true

  },
  'problems.integrity': {
    type: [ModuleReferrencedComponentProblem],
    optional: true
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

const ModuleAnalysis = new SimpleSchema({
  date: {
    type: Date
  },
  scanId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  licenses: {
    type: [ModuleUsedLicenses]
  },
  components: {
    type: [ModuleReferrencedComponent]
  },
  statistics: {
    type: ModuleAnalysisStatistics
  },
  moduleRequirements:{
    type: RequirementsSchema,
    optional: true
  },
  release: {
    label: 'Release',
    type: String,
    optional: true
  }
});

const infrastructureComponentSettings = new SimpleSchema({
  key: {
    type: String
  },
  version: {
    type: String
  },
  public: {
    type: Boolean,
    optional: true
  }
});

export const ModuleViabilityConfigSchema = new SimpleSchema({
  enabled: {
    type: Boolean,
    optional: true
  },
  warningThreshold: {
    label: WARNING_TRASH,
    type: Number,
    max: 4,
    min: 0,
    custom: function () {
      if (this.value !== 0 && this.value < this.field('violationThreshold').value) {
        return 'invalidConfiguration';
      }
    },
    autoform: {
      afFieldInput: {
        type: 'noUiSlider',
        noUiSliderOptions: {
          step: 1,
          connect: 'lower'
        },
        noUiSlider_pipsOptions: {
          mode: 'positions',
          values: [0, 25, 50, 75, 100],
          density: 10,
          format: {
            to: function (value) {
              let list = [NO_MONITORING, VERY_LOW_ACTIVITY, LOW_ACTIVITY, NORMAL_ACTIVITY, VERY_ACTIVE];
              return list[value]
            },
            from: function (value) {
              let list = [NO_MONITORING, VERY_LOW_ACTIVITY, LOW_ACTIVITY, NORMAL_ACTIVITY, VERY_ACTIVE];
              return list.indexOf(value)
            }
          }
        }
      }
    }
  },
  violationThreshold: {
    label: VIOLATION_TRASH,
    type: Number,
    max: 4,
    min: 0,
    custom: function () {
      if (this.field('warningThreshold').value !== 0 && this.value > this.field('warningThreshold').value) {
        return 'invalidConfiguration';
      }
    },
    autoform: {
      afFieldInput: {
        type: 'noUiSlider',
        noUiSliderOptions: {
          step: 1,
          connect: 'lower'
        },
        noUiSlider_pipsOptions: {
          mode: 'positions',
          values: [0, 25, 50, 75, 100],
          density: 10,
          format: {
            to: function (value) {
              let list = [NO_MONITORING, VERY_LOW_ACTIVITY, LOW_ACTIVITY, NORMAL_ACTIVITY, VERY_ACTIVE];
              return list[value]
            },
            from: function (value) {
              let list = [NO_MONITORING, VERY_LOW_ACTIVITY, LOW_ACTIVITY, NORMAL_ACTIVITY, VERY_ACTIVE];
              return list.indexOf(value)
            }
          }
        }
      }
    }
  },
  minConfidence: {
    label: 'Minimum confidence level',
    type: Number,
    max: 3,
    min: 1,
    autoform: {
      afFieldInput: {
        type: 'noUiSlider',
        noUiSliderOptions: {
          step: 1,
          connect: 'lower'
        },
        noUiSlider_pipsOptions: {
          mode: 'positions',
          values: [0, 50, 100],
          density: 50,
          format: {
            to: function (value) {
              let list = ['one indicator', 'two indicators', 'three indicators'];
              return list[value - 1]
            },
            from: function (value) {
              let list = ['one indicator', 'two indicators', 'three indicators'];
              return list.indexOf(value) - 1
            }
          }
        }
      }
    }
  },
  noInfoLevel: {
    label: 'Status shown, if minimum confidence level not reached',
    type: Number,
    max: 3,
    min: 1,
    autoform: {
      afFieldInput: {
        type: 'select',
        options: [
          {label: 'OK', value: 1},
          {label: 'Warning', value: 2},
          {label: 'Violation', value: 3}
        ]
      }
    }
  }
});

ModuleViabilityConfigSchema.messages({
  invalidConfiguration: '\'Warning threshold\' must not be lower than \'Violation threshold\''
});

export const ModuleVersioningConfigSchema = new SimpleSchema({
  enabled: {
    type: Boolean,
    optional: true
  },
  jump: {
    label: 'Versioning jump detection',
    type: Boolean,
    autoform: {
      afFieldInput: {
        type: 'switch'
      }
    }
  },
  warningThreshold: {
    label: WARNING_TRASH,
    type: Number,
    max: 3,
    min: 0,
    custom: function () {
      if (this.value !== 0 && this.value < this.field('violationThreshold').value) {
        return 'invalidConfiguration';
      }
    },
    autoform: {
      afFieldInput: {
        type: 'noUiSlider',
        noUiSliderOptions: {
          step: 1,
          connect: 'lower'
        },
        noUiSlider_pipsOptions: {
          mode: 'positions',
          values: [0, 33.33333333333333333333, 66.66666666666666666666, 100], // dont touch, as it cause make rounding problem
          density: 33.33333333333333333333, // dont touch, as it cause make rounding problem
          format: {
            to: function (value) {
              let list = [NO_MONITORING, MORE_7, MORE_4_LESS_6, LESS_3];
              return list[value]
            },
            from: function (value) {
              let list = [NO_MONITORING, MORE_7, MORE_4_LESS_6, LESS_3];
              return list.indexOf(value)
            }
          }
        }
      }
    }
  },
  violationThreshold: {
    label: VIOLATION_TRASH,
    type: Number,
    max: 3,
    min: 0,
    custom: function () {
      if (this.field('warningThreshold').value !== 0 && this.value > this.field('warningThreshold').value) {
        return 'invalidConfiguration';
      }
    },
    autoform: {
      afFieldInput: {
        type: 'noUiSlider',
        noUiSliderOptions: {
          step: 1,
          connect: 'lower'
        },
        noUiSlider_pipsOptions: {
          mode: 'positions',
          values: [0, 33.33333333333333333333, 66.66666666666666666666, 100], // dont touch, as it cause make rounding problem
          density: 33.33333333333333333333, // dont touch, as it cause make rounding problem
          format: {
            to: function (value) {
              let list = [NO_MONITORING, MORE_7, MORE_4_LESS_6, LESS_3];
              return list[value]
            },
            from: function (value) {
              let list = [NO_MONITORING, MORE_7, MORE_4_LESS_6, LESS_3];
              return list.indexOf(value)
            }
          }
        }
      }
    }
  }
});

ModuleVersioningConfigSchema.messages({
  invalidConfiguration: '\'Warning threshold\' must not be lower than \'Violation threshold\''
});

const ModuleProperties = new SimpleSchema({
  architectureType: {
    label: 'Type of architecture',
    type: String,
    allowedValues: ['FEU', 'FEE', 'FES', 'BES', 'BEE', 'SC', 'IS', 'DC'],
    autoform: {
      type: 'select',
      options: [
        {label: 'Frontend-UI-Module', value: 'FEU'},
        {label: 'Frontend-Endpoint', value: 'FEE'},
        {label: 'Frontend-Service', value: 'FES'},
        {label: 'Backend-Service', value: 'BES'},
        {label: 'Backend-Endpoint', value: 'BEE'},
        {label: 'System component', value: 'SC'},
        {label: 'Infrastructure Service', value: 'IS'},
        {label: 'Distributable Component', value: 'DC'}
      ]
    },
    optional: true
  },
  architecture: {
    type: String,
    allowedValues: ['infrastructureModule', 'infrastructureTemplate', 'sourceCode'],
    optional: true,
    autoform: {
      type: 'select',
      options: [
        {label: 'Infrastructure module', value: 'infrastructureModule'},
        {label: 'Source code', value: 'sourceCode'}
      ]
    }
  },
  privacy: {
    label: 'Privacy',
    type: String,
    allowedValues: ['opensource', 'private'],
    optional: true,
    autoform: {
      type: 'select',
      options: [
        {label: 'Open source', value: 'opensource'},
        {label: 'Private', value: 'private'}
      ]
    }
  }
});

const ComponentCrawlerSchema = new SimpleSchema({
  lastVisit: {
    type: Date,
    optional: true
  },
  status: {
    type: Number,
    optional: true
  },
  info: {
    type: Object,
    optional: true
  },
  // OpenSSF Scorecard was removed; kept only because existing documents still carry this field.
  'info.ossfScore': {
    type: Object,
    optional: true
  },
  'info.score': {
    type: Object,
    optional: true
  },
  'info.license': {
    type: String,
    optional: true,
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select a license',
        allowClear: true
      },
      options: function () {
        return Utils.getLicensesLabels()
      }
    }
  },
  'info.private': {
    type: Boolean,
    optional: true
  },
  'info.created_at': {
    type: Date,
    optional: true
  },
  'info.updated_at': {
    type: Date,
    optional: true
  },
  'info.url': {
    type: String,
    optional: true
  },
  'info.homepage': {
    type: String,
    optional: true
  },
  'info.stargazers_count': {
    type: Number,
    optional: true
  },
  'info.language': {
    type: String,
    optional: true,
     
    allowedValues: ['C', 'C#', 'C/C++', 'Go', 'HTML', 'Java', 'Javascript', 'Kotlin',
      'Objective-C', 'PHP', 'Python', 'R', 'Ruby', 'Scala', 'Shell', 'Swift', 'Typescript'],
    autoform: {
      type: 'select2',
      afFieldInput: {
        placeholder: 'Select a language',
        allowClear: true
      },
      options: function () {
        return Utils.getAllowedLanguages.map((data)=>{
          return {
            label: data,
            value: data
          }
        })
      }
    }
  },
  'info.forks_count': {
    type: Number,
    optional: true
  },
  'info.open_issues_count': {
    type: Number,
    optional: true
  },
  'info.monthlyCommitCnt': {
    type: [Number],
    optional: true,
    autoform: {label: false}
  },
  'info.latestReleases': {
    type: [String],
    optional: true,
    autoform: {label: false}
  },
  vulnerability: { type: Array, optional: true },
  'vulnerability.$': { type: Object },
  'vulnerability.$.name': { type: String },
  'vulnerability.$.description': { type: String,
    autoform: {type: 'textarea'}
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
  }
});

const basicModuleSchemaAttributes = {
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
  name: {
    type: String,
    label: 'Name',
    // eslint-disable-next-line sonarjs/regex-complexity
    regEx: [/^[^<>]*$/, /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/],
    min: 1,
    max: 200
  },
  version: {
    type: String,
    label: 'Version',
    min: 1,
    max: 200,
    optional: true
  },
  description: {
    type: String,
    label: 'Description',
    optional: true,
    max: 2000
  },
  properties: {
    type: ModuleProperties,
    optional: true
  },
  quality: {
    type: Object,
    optional: true
  }
};

const EnvironmentalConfigSchema = new SimpleSchema({
  v2vectorString: {
    type: String,
    optional: true
  },
  v3vectorString: {
    type: String,
    optional: true
  },
  v4vectorString: {
    type: String,
    optional: true
  }
});

const extendedModuleSchemaAttributes = {
  projectId: {
    type: String,
    label: 'Assigned Project',
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  moduleIdentifier: {
    type: String,
    label: 'Module Identifier',
    max: 200
  },
  status: {
    type: String,
    optional: true
  },
  licenseConfig: {
    type: ModuleLicenseConfig,
    optional: true
  },
  componentConfig: {
    type: ModuleComponentConfig,
    optional: true
  },
  viabilityConfig: {
    type: ModuleViabilityConfigSchema,
    optional: true
  },
  // OpenSSF Scorecard was removed; kept only because existing module documents still carry this field.
  ossfConfig: {
    type: Object,
    optional: true,
    blackbox: true
  },
  versioningConfig: {
    type: ModuleVersioningConfigSchema,
    optional: true
  },
  cveConfig: {
    type: ModuleCveConfig,
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
  analysis: {
    type: [ModuleAnalysis],
    optional: true
  },
  requirements: {
    type: RequirementsSchema,
    optional: true
  },
  ciaRequirements: {
    type: CIARequirementsSchema,
    optional: true
  },
  // MDR/IVDR classification was removed; kept only because existing module documents still carry this field.
  classification:{
    type: Object,
    optional: true,
    blackbox: true
  },
  commercialTerms: {
    type: CommercialTermsSchema,
    optional: true
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
    type: [ModuleJiraIntegrations],
    optional: true
  },
  tfs: {
    type: [ModuleTfsIntegrations],
    optional: true
  },
  properties: {
    type: ModuleProperties,
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  },
  crawlerInfo: {
    type: ComponentCrawlerSchema,
    optional: true
  },
  release: {
    label: 'Release',
    type: [ReleaseConfig],
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
  infrastructureComponent: {
    type: infrastructureComponentSettings,
    optional: true
  },
  analysisRequired: {
    type: Boolean,
    optional: true
  },
  analyzed: {
    type: Date,
    optional: true
  },
  archived: {
    type: Date,
    optional: true
  },
  scanned: {
    type: Date,
    optional: true
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
  customComponents:{
    type: [CustomComponentSchema],
    optional: true
  },
  urls: {
    type: ComponentUrlsSchema,
    optional: true
  },
  // Deep scan was removed; kept only because existing documents still carry this field.
  deepScans: {
    type: [ComponentDeepScanSchema],
    optional: true
  },
  algorithmsConfig: {
    type: [AlgorithmsConfig],
    optional: true
  },
  environmentalConfig: {
    type: EnvironmentalConfigSchema,
    optional: true
  },
  endoflifePolicy: {
    type: EndoflifePolicy,
    optional: true
  },
  linkedModules: {
    type: Array,
    optional: true
  },
  'linkedModules.$': {
    type: Object,
    blackbox: true
  },
  linkedReleases: {
    type: Array,
    optional: true
  },
  'linkedReleases.$': {
    type: Object,
    blackbox: true
  }
};

export const ModuleSchemaBasicSettings = new SimpleSchema(basicModuleSchemaAttributes);
export const ModuleSchema = new SimpleSchema(_.extend(extendedModuleSchemaAttributes, basicModuleSchemaAttributes));

