import {Meteor} from 'meteor/meteor';
import Companies from '/imports/lib/collections/companies';
import LogEvents from '/imports/lib/collections/logevents';
import {userDisplayName} from '/imports/lib/user/displayName';

const ACCOUNT_MOD = 'Account modified'
const POLICY_MOD = 'Policy modified'
const RULES_MOD = 'Rules modified'
const LICENSE_MOD = 'License modified'
const IC_MOD = 'iComponent modified'
const USER_MOD = 'User modified'
const MODULE_MOD = 'Module modified'
const API_ACTIVITY_RECORDED = 'API activity recorded'
const INTEGRATION_MOD = 'Integration modified'
const COTS_MOD = 'COTS modified'
const PROJECT_MOD = 'Project modified'
const MV_MOD = 'Manual vulnerability modified'
const TAGS_MOD = 'Tags modified'
const COMP_MOD = 'Component updated'
const BW_MOD = 'Allow/deny-list modified'
const RISK_MOD = 'Risk modified'
const TASK_MOD = 'Task modified'

export default async function logEvent(user, msg, type) {
  if (!user) {
    throw new Error('Please specify "user" argument for logEvent()');
  }
  if (typeof user !== 'string' && !user.profile) {
    throw new Error('Please specify at least userId for logEvent()');
  }
  if (typeof msg !== 'string') {
    throw new Error('Please specify a msg for logEvent()');
  }
  if (typeof type !== 'string') {
    throw new Error('Please specify a type for logEvent()');
  }
  const options = mapUser(user);
  await updateUser(options);
  await updateCompany(options);
  updateLogEventsTypes(options,type);
  await write(options, msg, type);
}

async function write(options, msg, type) {
  await LogEvents.insertAsync({
    date: new Date(),
    account: options.account,
    userId: options.userId,
    userName: options.userName,
    companyId: options.companyId,
    projectId: options.projectId || null,
    moduleId: options.moduleId || null,
    company: options.company,
    message: msg,
    typeLabel: options.typeLabel || null,
    type: type
  });
}

function mapUser(user) {
  const options = {};
  if (user.profile) {
    options.userId = user._id;
    options.account = user.emails && user.emails[0] && user.emails[0].address || user.profile.email;
    // Self-service registrations carry no profile.name, which showed as an empty/"undefined"
    // NAME column in the audit log.
    options.userName = userDisplayName(user);
    options.companyId = user.profile.companyId;
  } else {
    options.userId = user;
  }
  return options;
}

async function updateUser(options) {
  if (!options.userName || !options.account || !options.companyId) {
    const user = await Meteor.users.findOneAsync(options.userId, {fields: {emails: true, profile: true}});
    if (user) {
      options.account = (user.emails && user.emails[0] && user.emails[0].address) || (user.profile && user.profile.email);
      // Same fallback as mapUser() above. This branch runs precisely when userName was empty,
      // so reading profile.name raw here let the missing name straight back in via the path
      // that exists to repair it.
      options.userName = userDisplayName(user);
      options.companyId = user.profile.companyId;
    } else {
      options.userName = 'unknown';
      options.company = 'unknown';
      delete options.companyId;
      delete options.userId;
    }
  }
}

async function updateCompany(options) {
  let company;
  if (options.companyId) {
    company = await Companies.findOneAsync(options.companyId, {fields: {name: true}});
  }
  if (company) {
    options.company = company.name;
  } else {
    options.company = 'unknown';
    delete options.companyId;
  }
}

export const logEventsTypes = [
  {
    key:'companyCreation',
    label:ACCOUNT_MOD
  },{
    key:'userLogin',
    label:'User login',
    disabled:true
  },{
    key:'userLogout',
    label:'User logout',
    disabled:true
  },{
    key:'emailVerification',
    label:USER_MOD
  },{
    key:'emailReset',
    label:USER_MOD
  },{
    key:'userInvitation',
    label:USER_MOD
  },{
    key:'userInvitationAccepted',
    label:USER_MOD
  },{
    key:'userCreated',
    label:ACCOUNT_MOD
  },{
    key:'scanCreated',
    label:'Scan added'
  },{
    key:'scanDeleted',
    label:'Scan deleted'
  },{
    key:'scanProcessing',
    label:'Scan processed'
  },{
    key:'moduleAnalyzeProcessing',
    label:MODULE_MOD
  },{
    key:'analyzeAllModules',
    label:PROJECT_MOD
  },{
    key:'componentCreated',
    label:'Component modified'
  },{
    key:'componentUpdated',
    label:'Component modified'
  },{
    key:'componentDeleted',
    label:'Component deleted',
    disabled:true
  },{
    key:'componentPrivacyUpdated',
    label:COMP_MOD
  },{
    key:'componentStatusUpdated',
    label:COMP_MOD
  },{
    key:'moduleCreated',
    label:PROJECT_MOD
  },{
    key:'moduleDeleted',
    label:PROJECT_MOD
  },{
    key:'markComponentUnchanged',
    label:COMP_MOD
  },{
    key:'markComponentLooseCoupled',
    label:COMP_MOD
  },{
    key:'markComponentWhitelisted',
    label:COMP_MOD
  },{
    key:'markComponentBlacklisted',
    label:BW_MOD
  },{
    key:'markComponentLicensesSelected',
    label:COMP_MOD
  },{
    key:'markLicenseBlackListed',
    label:BW_MOD
  },{
    key:'markLicenseWhiteListed',
    label:BW_MOD
  },{
    key:'markCveWhiteListed',
    label:'Vulnerability muted'
  },{
    key:'markCveBlackListed',
    label:BW_MOD
  },{
    key:'moduleSettingsUpdated',
    label:MODULE_MOD
  },{
    key:'moduleLegalSettingsUpdated',
    label:MODULE_MOD
  },{
    key:'moduleViabilitySettingsUpdated',
    label:MODULE_MOD
  },{
    key:'moduleCIASettingsUpdated',
    label:MODULE_MOD
  },{
    key:'moduleVersioningSettingsUpdated',
    label:MODULE_MOD
  },{
    key:'moduleСommercialTermsUpdated',
    label:MODULE_MOD
  },{
    key:'moduleAnalysisDeleted',
    label:MODULE_MOD
  },{
    key:'projectCreated',
    label:PROJECT_MOD
  },{
    key:'projectSettingsUpdated',
    label:PROJECT_MOD
  },{
    key:'projectLegalSettingsUpdated',
    label:PROJECT_MOD
  },{
    key:'projectCIASettingsUpdated',
    label:PROJECT_MOD
  },{
    key:'projectDeleted',
    label:'Project deleted'
  },{
    key:'companySettingsUpdated',
    label:ACCOUNT_MOD
  },{
    key:'privateLicensesProcessing',
    label:'Private licenses modified'
  },{
    key:'privateAlgorithmsProcessing',
    label:'Private algorithms modified'
  },{
    key:'publicBoMKeyProcessing',
    label:API_ACTIVITY_RECORDED
  },{
    key:'publicNoticeKeyProcessing',
    label:API_ACTIVITY_RECORDED
  },{
    key:'publicReleaseKeyProcessing',
    label:API_ACTIVITY_RECORDED
  },{
    key:'apiKeyProcessing',
    label:API_ACTIVITY_RECORDED
  },{
    key:'leanIxSettingsUpdated',
    label:INTEGRATION_MOD
  },{
    key:'jiraSettingsUpdated',
    label:INTEGRATION_MOD
  },{
    key:'tfsSettingsUpdated',
    label:INTEGRATION_MOD
  },{
    key:'githubSettingsUpdated',
    label:INTEGRATION_MOD
  },{
    key:'billingSettingsUpdated',
    label:ACCOUNT_MOD
  },{
    key:'accountTypeUpdated',
    label:ACCOUNT_MOD
  },{
    key:'followAction',
    label:'Subscription'
  },{
    key:'nameAnalysis',
    label:'Analysis named'
  },{
    key:'approveProject',
    label:'Project approval'
  },{
    key:'approveModule',
    label:'Module approval'
  },{
    key:'markError',
    label:'Error occurred'
  },{
    key:'customComponent',
    label:COMP_MOD
  },{
    key:'policyCreated',
    label:POLICY_MOD
  },{
    key:'policyUpdated',
    label:POLICY_MOD
  },{
    key:'policyDeleted',
    label:POLICY_MOD
  },{
    key:'policyConfirmed',
    label:'Policy confirmed'
  },{
    key:'policyPresented',
    label:'Policy presented'
  },{
    key:'policyViewed',
    label:'Policy viewed'
  },{
    key:'usersImport',
    label:'User imported'
  },{
    key:'userUpdate',
    label:USER_MOD
  },{
    key:'userRemove',
    label:'User removed'
  },{
    key:'constraintCreated',
    label:RULES_MOD
  },{
    key:'constraintDeleted',
    label:RULES_MOD
  },{
    key:'constraintUpdated',
    label:RULES_MOD
  },{
    key:'infrastructureComponentCreated',
    label:IC_MOD
  },{
    key:'infrastructureComponentUpdated',
    label:IC_MOD
  },{
    key:'infrastructureComponentDeleted',
    label:IC_MOD
  },{
    key:'ruleCreated',
    label:RULES_MOD
  },{
    key:'ruleDeleted',
    label:RULES_MOD
  },{
    key:'ruleUpdated',
    label:RULES_MOD
  },{
    key:'licenseCreated',
    label:LICENSE_MOD
  },{
    key:'licenseDeleted',
    label:LICENSE_MOD
  },{
    key:'licenseUpdated',
    label:LICENSE_MOD
  },{
    key:'ecsCheckService',
    label:'Check-service processed'
  },{
    key:'updateLicensesFromSPDX',
    label:'Licenses updated from SPDX'
  },{
    key:'approveCreate',
    label:'Approval created'
  },{
    key:'approveRemove',
    label:'Approval removed'
  },{
    key:'legalSettingsTemplateDeleted',
    label:'Legal settings templates removed'
  },{
    key:'legalSettingsTemplateUpdated',
    label:'Legal settings templates updated'
  },{
    key:'legalSettingsTemplateCreated',
    label:'Legal settings templates created'
  },{
    key:'noticeFileCreated',
    label:'Notice file created'
  },{
    key:'noticeFileUpdated',
    label:'Notice file updated'
  },{
    key:'noticeFileDeleted',
    label:'Notice file removed'
  },{
    key:'cotsComponentCreated',
    label:COTS_MOD
  },{
    key:'cotsComponentUpdated',
    label:COTS_MOD
  },{
    key:'cotsComponentDeleted',
    label:COTS_MOD
  },{
    key:'manualVulnerabilitiesCreated',
    label:MV_MOD
  },{
    key:'manualVulnerabilitiesUpdated',
    label:MV_MOD
  },{
    key:'manualVulnerabilitiesDeleted',
    label:MV_MOD
  },{
    key:'webhooksCreated',
    label:'Webhook created'
  },{
    key:'webhooksDeleted',
    label:'Webhook removed'
  },{
    key:'tagsCreated',
    label:TAGS_MOD
  },{
    key:'tagsUpdated',
    label:TAGS_MOD
  },{
    key:'tagsDeleted',
    label:TAGS_MOD
  },{
    key:'pinAction',
    label:'Pin to dashboard'
  },{
    key:'securityManagerAction',
    label:'Security manager activity'
  },{
    key:'csafCreated',
    label:'CSAF created'
  },{
    key:'csafUpdated',
    label:'CSAF updated'
  },{
    key:'csafPublished',
    label:'CSAF published'
  },{
    // A weakness a human assigned to a scanning rule the tool left
    // unclassified is a judgement call, so it is auditable like any other rule
    // change.
    key:'cweMappingAssigned',
    label:RULES_MOD
  },{
    key:'cweMappingRemoved',
    label:RULES_MOD
  },{
    // Every SARIF import for a project with the toggle on can now
    // write into the risk register, so each write is auditable - and a reconcile
    // that changes nothing writes no entry at all.
    key:'cweRiskCreated',
    label:RISK_MOD
  },{
    key:'cweRiskSourceRefsUpdated',
    label:RISK_MOD
  },{
    // These five were already being emitted (riskProperties/create.js,
    // riskProperties/remove.js, tasks/{create,update,remove}.js) but had never
    // been registered, so Company Logs showed a blank TYPE for each. Registering
    // only the two new keys above would have left five identical defects
    // standing in the same feature area. Purely additive.
    key:'riskPropertiesCreate',
    label:RISK_MOD
  },{
    key:'riskPropertiesRemove',
    label:RISK_MOD
  },{
    // Edits to a risk and to its countermeasures (riskProperties/update.js).
    key:'riskPropertiesUpdate',
    label:RISK_MOD
  },{
    key:'riskPropertiesCountermeasuresUpdate',
    label:RISK_MOD
  },{
    key:'tasksCreate',
    label:TASK_MOD
  },{
    key:'tasksUpdate',
    label:TASK_MOD
  },{
    key:'tasksRemove',
    label:TASK_MOD
  },{
    // Every scope that pushed a vulnerability alert out to a webhook
    // or channel is auditable, with the project, the release and the number of
    // new CVEs in the message.
    key:'vulnerabilityAlertDispatched',
    label:INTEGRATION_MOD
  },{
    // A license a compliance manager determined by hand is a legal
    // judgement about a third-party component, so setting one, withdrawing one
    // and applying them to a scan are each auditable.
    key:'componentLicenseResolved',
    label:MODULE_MOD
  },{
    key:'componentLicenseResolutionCleared',
    label:MODULE_MOD
  },{
    key:'componentLicensesApplied',
    label:MODULE_MOD
  },{
    key:'licenseRiskCreated',
    label:RISK_MOD
  },{
    key:'licenseRiskUpdated',
    label:RISK_MOD
  }
];

function updateLogEventsTypes(options,type) {
  let typeLabel;
  if (type) {
    typeLabel = logEventsTypes.find(function (item) {
      return item.key === type
    });
  }
  if (typeLabel) {
    options.typeLabel = typeLabel.label;
  }
}


