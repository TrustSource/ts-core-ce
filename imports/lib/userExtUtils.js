import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';

const UserExtUtils = {};

// Public roles:
// developer, compliance_manager, portfolio_manager, manager, account_admin,
// company_component_manager, company_security_manager

UserExtUtils.allRoles = function () {
  return [
    {
      key: 'developer',
      label: 'Developer',
      permissions: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'r',
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          issue: {
            switch: 'r',
            project: 'r',
            jira: {
              switch: 'r',
              settings: 'r',
              active: 'r'
            },
            tfs: {
              settings: 'r',
              active: 'r'
            },
            github: {
              settings: 'r',
              active: 'r'
            }
          },
          ModuleImportTab: {
            import: 'r'
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'rw',
            version: 'rw',
            description: 'rw',
            projectId: 'rw',
            tags: 'rw',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: 'r',
            project: 'r',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            project: 'r',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'rw'
            },
            import: 'rx',
            warningThreshold: 'rw',
            violationThreshold: 'rw',
            minConfidence: 'rw',
            noInfoLevel: 'rw'
          },
          versioning: {
            versioningConfig:{
              enabled: 'rw'
            },
            jump: 'rw',
            import: 'rx',
            warningThreshold: 'rw',
            violationThreshold: 'rw'
          },
          cia: {
            settings: 'rw',
            import: 'rx'
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'rw',
            import: 'rx'
          },
          endoflife: {
            settings: 'rw',
            import: 'rx'
          },
          quality: {
            settings: 'rw',
            import: 'rx'
          },
          releases: {
            analysis: 'r',
            scans: 'r'
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: 'rw',
            whitelist_component_approve: '',
            whitelist_component: 'rw',
            blacklist_license: 'rw',
            blacklist_component: 'rw'
          },
          cveWhitelist: {
            list: 'rw'
          },
          customComponents: {
            settings: 'rw'
          },
          SPDXExportTab: {
            export: 'rx'
          },
          danger: {
            delete: 'rx',
            delete_history: 'rx'
          }
        }
      },
      extendIfMember: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'r',
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          issue: {
            switch: 'r',
            project: 'r',
            jira: {
              switch: 'r',
              settings: 'r',
              active: 'r'
            },
            tfs: {
              settings: 'r',
              active: 'r'
            },
            github: {
              settings: 'r',
              active: 'r'
            }
          },
          ModuleImportTab: {
            import: 'r'
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'rw',
            version: 'rw',
            description: 'rw',
            projectId: 'rw',
            tags: 'rw',
            leanix: 'rw',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: 'r',
            project: 'r',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            project: 'r',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'rw'
            },
            import: 'rx',
            warningThreshold: 'rw',
            violationThreshold: 'rw',
            minConfidence: 'rw',
            noInfoLevel: 'rw'
          },
          versioning: {
            versioningConfig:{
              enabled: 'rw'
            },
            jump: 'rw',
            import: 'rx',
            warningThreshold: 'rw',
            violationThreshold: 'rw'
          },
          cia: {
            settings: 'rw',
            import: 'rx'
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'rw',
            import: 'rx'
          },
          endoflife: {
            settings: 'rw',
            import: 'rx'
          },
          quality: {
            settings: 'rw',
            import: 'rx'
          },
          releases: {
            analysis: 'r',
            scans: 'r'
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: 'rw',
            whitelist_component_approve: '',
            whitelist_component: 'rw',
            blacklist_license: 'rw',
            blacklist_component: 'rw'
          },
          cveWhitelist: {
            list: 'rw'
          },
          customComponents: {
            settings: 'rw'
          },
          SPDXExportTab: {
            export: 'rx'
          },
          danger: {
            delete: 'rx',
            delete_history: 'rx'
          }
        }
      },
      extendIfNotMember: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'r',
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          issue: {
            switch: 'r',
            project: 'r',
            jira: {
              switch: 'r',
              settings: 'r',
              active: 'r'
            },
            tfs: {
              settings: 'r',
              active: 'r'
            },
            github: {
              settings: 'r',
              active: 'r'
            }
          },
          ModuleImportTab: {
            import: 'r'
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'r',
            version: 'r',
            description: 'r',
            projectId: 'r',
            tags: 'r',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: 'r',
            project: 'r',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            project: 'r',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'r'
            },
            import: 'r',
            warningThreshold: 'r',
            violationThreshold: 'r',
            minConfidence: 'r',
            noInfoLevel: 'r'
          },
          versioning: {
            versioningConfig:{
              enabled: 'r'
            },
            jump: 'r',
            import: 'r',
            warningThreshold: 'r',
            violationThreshold: 'r'
          },
          cia: {
            settings: 'r',
            import: 'r'
          },
          capabilities: {
            settings: 'r',
            import: 'r'
          },
          encryption: {
            settings: 'r',
            import: 'r'
          },
          endoflife: {
            settings: 'r',
            import: 'r'
          },
          quality: {
            settings: 'r',
            import: 'r'
          },
          releases: {
            analysis: 'r',
            scans: 'r'
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          cveWhitelist: {
            list: 'r'
          },
          customComponents: {
            settings: 'r'
          },
          SPDXExportTab: {
            export: 'r'
          },
          danger: {
            delete: '',
            delete_history: ''
          }
        }
      }
    },
    {
      key: 'compliance_manager',
      label: 'Compliance manager',
      permissions: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'rw',
            whitelist_license_approve: 'rx',
            whitelist_license: 'rw',
            whitelist_component_approve: 'rx',
            whitelist_component: 'rw',
            blacklist_license: 'rw',
            blacklist_component: 'rw'
          },
          issue: {
            switch: 'r',
            project: 'r',
            jira: {
              switch: 'r',
              settings: 'r',
              active: 'r'
            },
            tfs: {
              settings: 'r',
              active: 'r'
            },
            github: {
              settings: 'r',
              active: 'r'
            }
          },
          ModuleImportTab: {
            import: 'r'
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'r',
            version: 'r',
            description: 'r',
            projectId: 'r',
            tags: 'r',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: 'r',
            project: 'r',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            project: 'r',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'r'
            },
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r',
            minConfidence: 'r',
            noInfoLevel: 'r'
          },
          versioning: {
            versioningConfig:{
              enabled: 'r'
            },
            jump: 'r',
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r'
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          releases: {
            analysis: 'r',
            scans: 'r'
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          cveWhitelist: {
            list: 'r'
          },
          customComponents: {
            settings: 'r'
          },
          SPDXExportTab: {
            export: 'rx'
          },
          danger: {
            delete: '',
            delete_history: ''
          }
        }
      },
      extendIfDefault: {
        project: {
          general: {
            name: 'rw',
            description: 'rw',
            tags: 'rw',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'rw',
              defaultComplianceManager: 'rw',
              members: 'rw'
            }
          },
          legal: {
            settings: 'rw',
            wizard: 'rx',
            import_template: 'rx',
            import: 'rx',
            propagate: 'rx'
          },
          obligationConfig: {
            list: 'rw',
            import: 'rx',
            propagate: 'rx'
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'rw',
            whitelist_license_approve: 'rx',
            whitelist_license: 'rw',
            whitelist_component_approve: 'rx',
            whitelist_component: 'rw',
            blacklist_license: 'rw',
            blacklist_component: 'rw'
          },
          issue: {
            switch: 'r',
            project: 'r',
            jira: {
              switch: 'r',
              settings: 'r',
              active: 'r'
            },
            tfs: {
              settings: 'r',
              active: 'r'
            },
            github: {
              settings: 'r',
              active: 'r'
            }
          },
          ModuleImportTab: {
            import: 'rx'
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'r',
            version: 'r',
            description: 'r',
            projectId: 'rw',
            tags: 'rw',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'rw',
            relatedUsers: {
              defaultProjectManager: 'rw',
              defaultComplianceManager: 'rw',
              members: 'rw'
            },
            properties: {
              privacy: 'rw'
            }
          },
          legal: {
            settings: 'rw',
            project: 'rw',
            wizard: 'rx',
            import_template: 'rx',
            import_project: 'rx',
            propagate: 'rx'
          },
          obligationConfig: {
            list: 'rw',
            import: 'rx',
            propagate: 'rx'
          },
          viability: {
            viabilityConfig:{
              enabled: 'rw'
            },
            import: 'rx',
            warningThreshold: 'rw',
            violationThreshold: 'rw',
            minConfidence: 'rw',
            noInfoLevel: 'rw'
          },
          versioning: {
            versioningConfig:{
              enabled: 'rw'
            },
            jump: 'rw',
            import: 'rx',
            warningThreshold: 'rw',
            violationThreshold: 'rw'
          },
          cia: {
            settings: 'rw',
            import: 'rx'
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'rw',
            import: 'rx'
          },
          endoflife: {
            settings: 'rw',
            import: 'rx'
          },
          quality: {
            settings: 'rw',
            import: 'rx'
          },
          releases: {
            analysis: 'rwd',
            scans: 'r'
          },
          wblist: {
            whitelist_license_approve: 'rx',
            whitelist_license: 'rwd',
            whitelist_component_approve: 'rx',
            whitelist_component: 'rwd',
            blacklist_license: 'rwd',
            blacklist_component: 'rwd'
          },
          cveWhitelist: {
            list: 'rwd'
          },
          customComponents: {
            settings: 'rwd'
          },
          SPDXExportTab: {
            export: 'rx'
          },
          danger: {
            delete: '',
            delete_history: ''
          }
        }
      }
    },
    {
      key: 'portfolio_manager',
      label: 'Portfolio manager',
      permissions: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'rw',
              defaultComplianceManager: 'rw',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'r',
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          issue: {
            switch: 'r',
            project: 'r',
            jira: {
              switch: 'r',
              settings: 'r',
              active: 'r'
            },
            tfs: {
              settings: 'r',
              active: 'r'
            },
            github: {
              settings: 'r',
              active: 'r'
            }
          },
          ModuleImportTab: {
            import: 'r'
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'r',
            version: 'r',
            description: 'r',
            projectId: 'r',
            tags: 'rw',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'rw',
              defaultComplianceManager: 'rw',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: 'r',
            project: 'r',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            project: 'r',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'r'
            },
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r',
            minConfidence: 'r',
            noInfoLevel: 'r'
          },
          versioning: {
            versioningConfig:{
              enabled: 'r'
            },
            jump: 'r',
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r'
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          releases: {
            analysis: 'r',
            scans: 'r'
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          cveWhitelist: {
            list: 'r'
          },
          customComponents: {
            settings: 'r'
          },
          SPDXExportTab: {
            export: 'rx'
          },
          danger: {
            delete: '',
            delete_history: ''
          }
        }
      }
    },
    {
      key: 'manager',
      label: 'Manager',
      permissions: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'r',
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          issue: {
            switch: 'r',
            project: 'r',
            jira: {
              switch: 'r',
              settings: 'r',
              active: 'r'
            },
            tfs: {
              settings: 'r',
              active: 'r'
            },
            github: {
              settings: 'r',
              active: 'r'
            }
          },
          ModuleImportTab: {
            import: 'r'
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'r',
            version: 'r',
            description: 'r',
            projectId: 'r',
            tags: 'r',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: 'r',
            project: 'r',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            project: 'r',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'r'
            },
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r',
            minConfidence: 'r',
            noInfoLevel: 'r'
          },
          versioning: {
            versioningConfig:{
              enabled: 'r'
            },
            jump: 'r',
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r'
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          releases: {
            analysis: 'r',
            scans: 'r'
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          cveWhitelist: {
            list: 'r'
          },
          customComponents: {
            settings: 'r'
          },
          SPDXExportTab: {
            export: 'rx'
          },
          danger: {
            delete: '',
            delete_history: ''
          }
        }
      },
      extendIfDefault: {
        project: {
          general: {
            name: 'rw',
            description: 'rw',
            tags: 'rw',
            leanix: 'rw',
            relatedUsers: {
              defaultProjectManager: 'rw',
              defaultComplianceManager: 'rw',
              members: 'rw'
            }
          },
          legal: {
            settings: 'rw',
            wizard: 'rx',
            import_template: 'rx',
            import: 'rx',
            propagate: 'rx'
          },
          obligationConfig: {
            list: 'rw',
            import: 'rx',
            propagate: 'rx'
          },
          cia: {
            settings: 'rw',
            import: 'rx'
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'rw',
            import: 'rx'
          },
          endoflife: {
            settings: 'rw',
            import: 'rx'
          },
          quality: {
            settings: 'rw',
            import: 'rx'
          },
          wblist: {
            enforce: 'rw',
            whitelist_license_approve: 'rx',
            whitelist_license: 'rw',
            whitelist_component_approve: 'rx',
            whitelist_component: 'rw',
            blacklist_license: 'rw',
            blacklist_component: 'rw'
          },
          issue: {
            switch: 'rw',
            project: 'rw',
            jira: {
              switch: 'rw',
              settings: 'rw',
              active: 'rw'
            },
            tfs: {
              settings: 'rw',
              active: 'rw'
            },
            github: {
              settings: 'rw',
              active: 'rw'
            }
          },
          ModuleImportTab: {
            import: 'rx'
          },
          danger: {
            delete: 'rx'
          }
        },
        module: {
          general: {
            name: 'rw',
            version: 'rw',
            description: 'rw',
            projectId: 'rw',
            tags: 'rwd',
            leanix: 'rw',
            moduleIdentifier: 'r',
            architectureType: 'rw',
            relatedUsers: {
              defaultProjectManager: 'rw',
              defaultComplianceManager: 'rw',
              members: 'rw'
            },
            properties: {
              privacy: 'rw'
            }
          },
          legal: {
            settings: 'rw',
            project: 'rw',
            wizard: 'rx',
            import_template: 'rx',
            import_project: 'rx',
            propagate: 'rx'
          },
          obligationConfig: {
            list: 'rw',
            project: 'rw',
            import: 'rx',
            propagate: 'rx'
          },
          viability: {
            viabilityConfig:{
              enabled: 'rw'
            },
            import: 'rx',
            warningThreshold: 'rw',
            violationThreshold: 'rw',
            minConfidence: 'rw',
            noInfoLevel: 'rw'
          },
          versioning: {
            versioningConfig:{
              enabled: 'rw'
            },
            jump: 'rw',
            import: 'rx',
            warningThreshold: 'rw',
            violationThreshold: 'rw'
          },
          cia: {
            settings: 'rw',
            import: 'rx'
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'rw',
            import: 'rx'
          },
          endoflife: {
            settings: 'rw',
            import: 'rx'
          },
          quality: {
            settings: 'rw',
            import: 'rx'
          },
          releases: {
            analysis: 'rwd',
            scans: 'r'
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: 'rwd',
            whitelist_component_approve: '',
            whitelist_component: 'rwd',
            blacklist_license: 'rwd',
            blacklist_component: 'rwd'
          },
          cveWhitelist: {
            list: 'rwd'
          },
          customComponents: {
            settings: 'rwd'
          },
          SPDXExportTab: {
            export: 'rx'
          },
          danger: {
            delete: 'rx',
            delete_history: 'rx'
          }
        }
      }
    },
    {
      key: 'account_admin',
      label: 'Account admin',
      permissions: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'rw',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'r',
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          issue: {
            switch: 'rw',
            project: 'rw',
            jira: {
              switch: 'rw',
              settings: 'rw',
              active: 'rw'
            },
            tfs: {
              settings: 'rw',
              active: 'rw'
            },
            github: {
              settings: 'rw',
              active: 'rw'
            }
          },
          ModuleImportTab: {
            import: ''
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'r',
            version: 'r',
            description: 'r',
            projectId: 'r',
            tags: 'r',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: '',
            project: '',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: '',
            project: '',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'r'
            },
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r',
            minConfidence: 'r',
            noInfoLevel: 'r'
          },
          versioning: {
            versioningConfig:{
              enabled: 'r'
            },
            jump: 'r',
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r'
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          releases: {
            analysis: '',
            scans: ''
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: '',
            whitelist_component_approve: '',
            whitelist_component: '',
            blacklist_license: '',
            blacklist_component: ''
          },
          cveWhitelist: {
            list: 'r'
          },
          customComponents: {
            settings: 'r'
          },
          SPDXExportTab: {
            export: ''
          },
          danger: {
            delete: '',
            delete_history: ''
          }
        }
      }
    },
    {
      key: 'company_component_manager',
      label: 'Company component manager',
      permissions: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'r',
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          issue: {
            switch: '',
            project: '',
            jira: {
              switch: '',
              settings: '',
              active: ''
            },
            tfs: {
              settings: '',
              active: ''
            },
            github: {
              settings: '',
              active: ''
            }
          },
          ModuleImportTab: {
            import: ''
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'r',
            version: 'r',
            description: 'r',
            projectId: 'r',
            tags: 'r',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: '',
            project: '',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: '',
            project: '',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'r'
            },
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r',
            minConfidence: 'r',
            noInfoLevel: 'r'
          },
          versioning: {
            versioningConfig:{
              enabled: 'r'
            },
            jump: 'r',
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r'
          },
          cia: {
            settings: 'r',
            import: ''
          },
          capabilities: {
            settings: 'r',
            import: ''
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          releases: {
            analysis: '',
            scans: ''
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: '',
            whitelist_component_approve: '',
            whitelist_component: '',
            blacklist_license: '',
            blacklist_component: ''
          },
          cveWhitelist: {
            list: 'r'
          },
          customComponents: {
            settings: 'r'
          },
          SPDXExportTab: {
            export: ''
          },
          danger: {
            delete: '',
            delete_history: ''
          }
        }
      }
    },
    {
      key: 'company_security_manager',
      label: 'Company security manager',
      permissions: {
        project: {
          general: {
            name: 'r',
            description: 'r',
            tags: 'r',
            leanix: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            }
          },
          legal: {
            settings: 'r',
            wizard: '',
            import_template: '',
            import: '',
            propagate: ''
          },
          obligationConfig: {
            list: 'r',
            import: '',
            propagate: ''
          },
          cia: {
            settings: 'rw',
            import: 'rx'
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          wblist: {
            enforce: 'r',
            whitelist_license_approve: '',
            whitelist_license: 'r',
            whitelist_component_approve: '',
            whitelist_component: 'r',
            blacklist_license: 'r',
            blacklist_component: 'r'
          },
          issue: {
            switch: '',
            project: '',
            jira: {
              switch: '',
              settings: '',
              active: ''
            },
            tfs: {
              settings: '',
              active: ''
            },
            github: {
              settings: '',
              active: ''
            }
          },
          ModuleImportTab: {
            import: ''
          },
          danger: {
            delete: ''
          }
        },
        module: {
          general: {
            name: 'r',
            version: 'r',
            description: 'r',
            projectId: 'r',
            tags: 'r',
            leanix: 'r',
            'moduleIdentifier': 'r',
            architectureType: 'r',
            relatedUsers: {
              defaultProjectManager: 'r',
              defaultComplianceManager: 'r',
              members: 'r'
            },
            properties: {
              privacy: 'r'
            }
          },
          legal: {
            settings: '',
            project: '',
            wizard: '',
            import_template: '',
            import_project: '',
            propagate: ''
          },
          obligationConfig: {
            list: '',
            project: '',
            import: '',
            propagate: ''
          },
          viability: {
            viabilityConfig:{
              enabled: 'r'
            },
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r',
            minConfidence: 'r',
            noInfoLevel: 'r'
          },
          versioning: {
            versioningConfig:{
              enabled: 'r'
            },
            jump: 'r',
            import: '',
            warningThreshold: 'r',
            violationThreshold: 'r'
          },
          cia: {
            settings: 'rw',
            import: 'rx'
          },
          capabilities: {
            settings: 'rw',
            import: 'rx'
          },
          encryption: {
            settings: 'r',
            import: ''
          },
          endoflife: {
            settings: 'r',
            import: ''
          },
          quality: {
            settings: 'r',
            import: ''
          },
          releases: {
            analysis: '',
            scans: ''
          },
          wblist: {
            whitelist_license_approve: '',
            whitelist_license: '',
            whitelist_component_approve: '',
            whitelist_component: '',
            blacklist_license: '',
            blacklist_component: ''
          },
          cveWhitelist: {
            list: 'r'
          },
          customComponents: {
            settings: 'r'
          },
          SPDXExportTab: {
            export: ''
          },
          danger: {
            delete: '',
            delete_history: ''
          }
        }
      }
    }
  ]
};

UserExtUtils.availableRoles = function () {
  return UserExtUtils.allRoles().filter(function (role) {
    return !role.secured
  })
}

UserExtUtils.availableRolesWithValues = function () {
  return UserExtUtils.availableRoles().map(function (role) {
    let {key, label} = role
    return {value:key, label}
  })
}

UserExtUtils.availableRolesKeys = function () {
  return UserExtUtils.availableRoles().map(function (role) {
    return role.key
  })
}

UserExtUtils.isSuperUser = function (roles) {
  const rolesMap = UserExtUtils.availableRolesKeys();
  const missingRoles = rolesMap.filter(item => roles.indexOf(item) === -1);
  return !missingRoles.length
}

UserExtUtils.allRolesKeys = function () {
  return UserExtUtils.allRoles().map(function (role) {
    return role.key
  })
}

function arrayToUnique(list) {
  return list.join('').split('').filter(function(item, i, ar){ return ar.indexOf(item) === i; }).join('')
}

function joinObjValues(obj){
  let out = [];
  Object.keys(obj).forEach(function (key){
    if(typeof obj[key] === 'string'){
      if(out.indexOf(obj[key] === -1)){
        out.push(obj[key]);
      }
    }else{
      out.push(joinObjValues(obj[key]));
    }
  })
  return arrayToUnique(out)
}

function getValueByString(object, path){
  let parts = path.split('.');
  let value = object;
  parts.forEach(function (part) {
    value = value[part]
  });
  const objOrEmpty = typeof value === 'object' ? joinObjValues(value) : '';
  return typeof value === 'string' ? value : objOrEmpty
}

/**
 * Which member context of `role` applies to `userId` on `entity`, a project or
 * module whose members are stored in `relatedUsers.members`:
 * 'member' when the user is listed, 'nonMember' when the entity has members but
 * not this user, null (the base permissions) when it has no members.
 */
UserExtUtils.memberContext = function (role, entity, userId) {
  const members = entity && entity.relatedUsers && entity.relatedUsers.members;
  if (!Array.isArray(members) || members.length === 0) {
    return null;
  }
  if (members.indexOf(userId) > -1) {
    return role.extendIfMember ? 'member' : null;
  }
  return role.extendIfNotMember ? 'nonMember' : null;
}

UserExtUtils.hasAccessRight = function (permission, right, entity) {
  const user = Meteor.isClient ? Meteor.user() : null;
  const companyId = user && user.profile && user.profile.companyId;
  const userRoles = companyId ? Roles.getRolesForUser(user, {scope: companyId}) : [];
  const availablePermissions = UserExtUtils.allRoles().filter(function (role) {
    return userRoles.indexOf(role.key) > -1 && role.permissions
  }).map(function (role){
    if(role.extendIfDefault && entity && (!entity.relatedUsers ||
      (entity.relatedUsers && ((role.key === 'manager' && entity.relatedUsers.defaultProjectManager === user._id) ||
        (role.key === 'compliance_manager' &&  entity.relatedUsers.defaultComplianceManager === user._id))) ||
      (entity.relatedUsers && ((role.key === 'manager' && !entity.relatedUsers.defaultProjectManager) ||
        (role.key === 'compliance_manager' &&  !entity.relatedUsers.defaultComplianceManager)))
    )){
      return getValueByString(role.extendIfDefault, permission)
    }
    const context = UserExtUtils.memberContext(role, entity, user._id);
    if (context === 'member') {
      return getValueByString(role.extendIfMember, permission)
    } else if (context === 'nonMember') {
      return getValueByString(role.extendIfNotMember, permission)
    }
    return getValueByString(role.permissions, permission)
  })
  // console.log(permission, right, entity, availablePermissions, arrayToUnique(availablePermissions).indexOf(right) > -1)
  return arrayToUnique(availablePermissions).indexOf(right) > -1
}

UserExtUtils.username = function (extUser) {
  let user = Meteor.isClient ? Meteor.user() : null;
  if (!user) {
    user = extUser
  }
  if (user) {
    if (user.profile && user.profile.name) {
      return user.profile.name;
    }
    if (user.name) {
      return user.name;
    }
    if (user.emails && user.emails[0] && user.emails[0].address) {
      return user.emails[0].address;
    }
    if (user.profile && user.profile.email) {
      return user.profile.email
    }
  }
  return 'anonymous';
};


UserExtUtils.userEmail = function (extUser) {
  let user = Meteor.isClient ? Meteor.user() : null;
  if (!user) {
    user = extUser
  }
  if (user) {
    if (user.emails && user.emails[0] && user.emails[0].address) {
      return user.emails[0].address;
    }
    if (user.profile && user.profile.email) {
      return user.profile.email
    }
  }
  return 'anonymous@user.com';
};


/**
 * check is user allow this notification
 * @param actionKey
 * @returns Boolean
 */
/*
 *- Event notifications
 * EVENTS_ALL
 ** All events
 * EVENTS_NEW
 ** New module analysis processed
 * EVENTS_CHANGES
 ** Analysis result changed
 * EVENTS_APPROVES
 ** Module new releases, approves or rejections
 * EVENTS_BY_EMAIL
 ** Send all events also by email
 *- Alarms notifications
 * ALARMS_ALL
 ** All alarms
 * ALARMS_COMPLIANCE
 ** Compliance issues in my project
 * ALARMS_VULNERABILITY
 ** New vulnerabilities in my project
 * ALARMS_ISSUES
 ** TrustSource operational issues
 * ALARMS_ENDOFLIFE
 ** End-of-life monthly digest
 * ALARMS_BY_EMAIL
 ** Send all alarms also by email
 *- General communications
 * NEWS_GENERAL
 ** TrustSource newsletter
 * NEWS_PROMO
 ** TrustSource events and promotional information
 * NEWS_EACG
 ** EACG events and promotional information
 */
UserExtUtils.isUserNotificationAllowed = function (user, actionKey) {
  const notifications = user.profile.notifications;
  if (Array.isArray(actionKey)) {
    return notifications && _.any(actionKey, function (element) {
      return _.contains(notifications, element)
    });
  } else {
    return notifications && _.contains(notifications, actionKey);
  }
};

export default UserExtUtils;
