const ACCOUNT_MOD = 'Account modified';
const USER_MOD = 'User modified';
const RULES_MOD = 'Rules modified';
const LICENSE_MOD = 'License modified';
const COMPONENT_MOD = 'Component modified';
const PROJECT_MOD = 'Project modified';
const INTEGRATION_MOD = 'Integration modified';
const POLICY_MOD = 'Policy modified';
const MODULE_MOD = 'Module modified';
const B_W_LIST_MOD = 'B/W-list modified';
const API_ACTIVITY = 'API activity recorded';
const I_COMPONENT_MOD = 'iComponent modified';
const COTS_MOD = 'COTS modified';
const IP_MOD = 'Identity provider modified';
const MW_MOD = 'Manual vulnerability modified';

let logEventsTypes = [
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
    label:COMPONENT_MOD
  },{
    key:'componentUpdated',
    label:COMPONENT_MOD
  },{
    key:'componentDeleted',
    label:'Component deleted',
    disabled:true
  },{
    key:'componentPrivacyUpdated',
    label:COMPONENT_MOD
  },{
    key:'componentStatusUpdated',
    label:COMPONENT_MOD
  },{
    key:'moduleCreated',
    label:PROJECT_MOD
  },{
    key:'moduleDeleted',
    label:PROJECT_MOD
  },{
    key:'markComponentUnchanged',
    label:COMPONENT_MOD
  },{
    key:'markComponentLooseCoupled',
    label:COMPONENT_MOD
  },{
    key:'markComponentWhitelisted',
    label:COMPONENT_MOD
  },{
    key:'markComponentBlacklisted',
    label:B_W_LIST_MOD
  },{
    key:'markComponentLicensesSelected',
    label:COMPONENT_MOD
  },{
    key:'markLicenseBlackListed',
    label:B_W_LIST_MOD
  },{
    key:'markLicenseWhiteListed',
    label:B_W_LIST_MOD
  },{
    key:'markCveWhiteListed',
    label:'Vulnerability muted'
  },{
    key:'markCveBlackListed',
    label:B_W_LIST_MOD
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
    key:'publicBoMKeyProcessing',
    label:API_ACTIVITY
  },{
    key:'publicNoticeKeyProcessing',
    label:API_ACTIVITY
  },{
    key:'apiKeyProcessing',
    label:API_ACTIVITY
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
    key:'billingSettingsUpdated',
    label:ACCOUNT_MOD
  },{
    key:'accountTypeUpdated',
    label:ACCOUNT_MOD
  },{
    key:'followAction',
    label:'Subscription'
  },{
    key:'freezedModule',
    label:'Module frozen'
  },{
    key:'approveProject',
    label:'Project approval '
  },{
    key:'approveModule',
    label:'Module approval'
  },{
    key:'markError',
    label:'Error occured'
  },{
    key:'customComponent',
    label:COMPONENT_MOD
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
    label:I_COMPONENT_MOD
  },{
    key:'infrastructureComponentUpdated',
    label:I_COMPONENT_MOD
  },{
    key:'infrastructureComponentDeleted',
    label:I_COMPONENT_MOD
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
    key:'identityProviderCreated',
    label:IP_MOD
  },{
    key:'identityProviderDeleted',
    label:IP_MOD
  },{
    key:'identityProviderUpdated',
    label:IP_MOD
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
    label:'Legal settings templates modified'
  },{
    key:'legalSettingsTemplateCreated',
    label:'Legal settings templates created'
  },{
    key:'noticeFileCreated',
    label:'Notice file created'
  },{
    key:'noticeFileUpdated',
    label:'Notice file modified'
  },{
    key:'deepScanCreated',
    label:'DeepScan created'
  },{
    key:'deepScanUpdated',
    label:'DeepScan modified'
  },{
    key:'deepScanExecuted',
    label:'DeepScan executed'
  },{
    key:'deepScanDeleted',
    label:'DeepScan modified'
  },{
    key:'soupFileCreated',
    label:'SOUP file created'
  },{
    key:'soupFileUpdated',
    label:'SOUP file modified'
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
    key:'createVulnerabilityMapFromProject',
    label:'Admin action'
  },{
    key:'manualVulnerabilitiesCreated',
    label:MW_MOD
  },{
    key:'manualVulnerabilitiesUpdated',
    label:MW_MOD
  },{
    key:'manualVulnerabilitiesDeleted',
    label:MW_MOD
  }
];

function mapUser(user) {
  const options = {};
  if (user.profile) {
    options.userId = user._id;
    options.account = user.emails && user.emails[0] && user.emails[0].address || user.profile.email;
    options.userName = user.profile.name;
    options.companyId = user.profile.companyId;
  } else {
    options.userId = user;
  }
  return options;
}

function updateUser(user, options) {
  if (!options.userName || !options.account || !options.companyId) {
    if (user) {
      options.account = user.emails[0].address;
      options.userName = user.profile.name;
      options.companyId = user.profile.companyId;
    } else {
      options.userName = 'unknown';
      options.company = 'unknown';
      delete options.companyId;
      delete options.userId;
    }
  }
}

function updateCompany(company, options) {
  if (company) {
    options.company = company.name;
  } else {
    options.company = 'unknown';
    delete options.companyId;
  }
}

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

const LogEvent = async function (db, company, user, msg, type) {
  try{
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
    updateUser(user, options);
    updateCompany(company, options);
    updateLogEventsTypes(options,type);
    await db.collection('logevents').insertOne({
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
  }catch (err) {
    console.log('=> an error occurred: ', err);
  }
};

export { LogEvent };


