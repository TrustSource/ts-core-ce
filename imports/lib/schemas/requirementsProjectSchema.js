 
import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const RequirementsSchema = new SimpleSchema({

  CA: {
    label: 'Some licenses may restrict commercialization options, others require different obligations depending on ' +
    'the type of commercialization model you select. So please indicate the intended commercial use.',
    type: String,
    allowedValues: ['CA_usage', 'CA_license', 'CA_support', 'CA_other',
      'CA_none'],
    autoform: {
      type: 'select-radio',
      options: [
        {label: 'Yes, a usage fee be charged for the product/service (must be explicitly governed in the contract)',
          value: 'CA_usage'},
        {label: 'Yes, a license fee will be charged for the product (examples include royalties or other types of fees)',
          value: 'CA_license'},
        {label: 'Yes, but only a support fee will be charged for services provided in addition to the product or service',
          value: 'CA_support'},
        {label: 'Yes, but another type of commercialisation is intended (e.g. maintenance or warranty)', value: 'CA_other'},
        {label: 'No, the product is not commercial', value: 'CA_none'}
      ]
    }
  },

  OM: {
    label: 'Some licenses have specific SaaS requirements or trigger additional obligations in case you will ' +
    'include them with hardware or operate them for third parties. So please indicate the operational model.',
    type: String,
    allowedValues: ['OM_SaaS', 'OM_mop', 'OM_sw', 'OM_dis'],
    autoform: {
      type: 'select-radio',
      options: [
        {label: 'Solution will be operated in a Software as a Service-Mode', value: 'OM_SaaS'},
        {label: 'We plan to operate it on our customer’s location(s) as a managed service', value: 'OM_mop'},
        {label: 'It will follow a traditional software-distribution model', value: 'OM_sw'},
        {label: 'The solution will be part of an appliance / distributed embedded in a device or hardware', value: 'OM_dis'}
      ]
    }
  },

  IP_protect: {
    label: 'Inbound IP Protection',
    type: String,
    allowedValues: ['IP_protect_n', 'IP_protect_y'],
    autoform: {
      group: 'IP',
      type: 'enumSwitch',
      trueValue: 'IP_protect_y',
      falseValue: 'IP_protect_n',
      options: [
        {label: 'We do not seek extended protection from 3rd party claims for this module', value: 'IP_protect_n'},
        {label: 'Explicitly reduce risk to be subject to patent claims by the contributors of the open source software',
          value: 'IP_protect_y'}
      ]
    }
  },

  IP_enforce: {
    label: 'Outbound IP Protection',
    type: String,
    allowedValues: ['IP_enforce_1', 'IP_enforce_2', 'IP_enforce_3'],
    autoform: {
      group: 'IP',
      type: 'enumSwitch',
      trueValue: 'IP_enforce_3',
      falseValue: 'IP_enforce_1',
      options: [
        {label: 'We do not seek enforcement of our claims', value: 'IP_enforce_1'},
        {label: 'Retain freedom to enforce own patent claims without risk of license termination', value: 'IP_enforce_2'},
        {label: 'Ensure freedom to enforce own patent claims without risk of license termination', value: 'IP_enforce_3'}
      ]
    }
  }

});

export const QuestionnaireSchemaStepOne = new SimpleSchema({

  CA: {
    label: 'Some licenses may restrict commercialization options, others require different obligations ' +
    'depending on the type of commercialization model you select. So please indicate the intended commercial use.',
    type: String,
    allowedValues: ['CA_usage', 'CA_license', 'CA_support', 'CA_other',
      'CA_none'],
    autoform: {
      type: 'select-radio',
      options: [
        {label: 'Yes, a usage fee be charged for the product/service (must be explicitly governed in the contract)',
          value: 'CA_usage'},
        {label: 'Yes, a license fee will be charged for the product (examples include royalties or other types of fees)',
          value: 'CA_license'},
        {label: 'Yes, but only a support fee will be charged for services provided in addition to the product or service',
          value: 'CA_support'},
        {label: 'Yes, but another type of commercialisation is intended (e.g. maintenance or warranty)', value: 'CA_other'},
        {label: 'No, the product is not commercial', value: 'CA_none'}
      ]
    }
  }

});

export const QuestionnaireSchemaStepTwo = new SimpleSchema({

  OM: {
    label: 'Some licenses have specific SaaS requirements or trigger additional obligations in case you will ' +
    'include them with hardware or operate them for third parties. So please indicate the operational model.',
    type: String,
    allowedValues: ['OM_SaaS', 'OM_mop', 'OM_sw', 'OM_dis'],
    autoform: {
      type: 'select-radio',
      options: [
        {label: 'Solution will be operated in a Software as a Service-Mode', value: 'OM_SaaS'},
        {label: 'We plan to operate it on our customer’s location(s) as a managed service', value: 'OM_mop'},
        {label: 'It will follow a traditional software-distribution model', value: 'OM_sw'},
        {label: 'The solution will be part of an appliance / distributed embedded in a device or hardware', value: 'OM_dis'}
      ]
    }
  }

});

export const QuestionnaireSchemaStepThree = new SimpleSchema({

  IP_protect: {
    label: 'Inbound IP Protection',
    type: String,
    allowedValues: ['IP_protect_n', 'IP_protect_y', 'IP_enforce_1', 'IP_enforce_2', 'IP_enforce_3'],
    autoform: {
      group: 'IP',
      type: 'enumSwitch',
      trueValue: 'IP_protect_y',
      falseValue: 'IP_protect_n',
      options: [
        {label: 'Explicitly reduce risk to be subject to patent claims by the contributors of the open source software',
          value: 'IP_protect_y'},
        {label: 'We do not seek extended protection from 3rd party claims for this module', value: 'IP_protect_n'}
      ]
    }
  },

  IP_enforce: {
    label: 'Outbound IP Protection',
    type: String,
    allowedValues: ['IP_protect_n', 'IP_protect_y', 'IP_enforce_1', 'IP_enforce_2', 'IP_enforce_3'],
    autoform: {
      group: 'IP',
      type: 'enumSwitch',
      trueValue: 'IP_enforce_3',
      falseValue: 'IP_enforce_1',
      options: [
        {label: 'Ensure freedom to enforce own patent claims without risk of license termination', value: 'IP_enforce_3'},
        {label: 'We do not seek enforcement of our claims', value: 'IP_enforce_1'}
      ]
    }
  }

});
