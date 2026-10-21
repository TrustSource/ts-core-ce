 
import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const RequirementsObject = new SimpleSchema({

  TS: {
    label: 'Trade Secret Protection',
    type: String,
    optional: true,
    allowedValues: ['TS_y', 'TS_n'],
    autoform: {
      type: 'enumSwitch',
      trueValue: 'TS_y',
      falseValue: 'TS_n',
      options: [
        {label: 'Yes, trade secrets need to be protected',
          value: 'TS_y'},
        {label: 'No, trade secrets may be released',
          value: 'TS_n'}
      ]
    }
  },

  LS: {
    label: 'Sub-licensing alert',
    type: String,
    optional: true,
    allowedValues: ['LS_pl', 'LS_os'],
    autoform: {
      type: 'enumSwitch',
      trueValue: 'LS_pl',
      falseValue: 'LS_os',
      options: [
        {label: 'This module shall be licensed under a proprietary license', value: 'LS_pl'},
        {label: 'It is planned to release the module as open source software', value: 'LS_os'}
      ]
    }
  },

  D: {
    label: 'If you plan to distribute your solution, it might lead to different obligations. ' +
    'So please indicate below which is the intended purpose or application of this module. ' +
    'TrustSource will resolve the obligations accordingly:',
    type: String,
    optional: true,
    allowedValues: ['D_op', 'D_ipoa', 'D_xa', 'D_cslib', 'D_sslib', 'D_never'],
    autoform: {
      group: 'IP',
      type: 'select-radio',
      options: [
        {label: 'Yes, it is for use on premise, distributed via separate installer, on physical media or via download',
          value: 'D_op'},
        {label: 'Yes, it is as an integral part of an appliance, device or software, which will be shipped',
          value: 'D_ipoa'},
        {label: 'Yes, it is an exchangeable addon to an appliance, device or software, which will be shipped',
          value: 'D_xa'},
        {label: 'Yes, it is a client side library in a web solution, provided to the user by a webserver',
          value: 'D_cslib'},
        {label: 'No, it is a server site library in a web solution, not being distributed',
          value: 'D_sslib'},
        {label: 'No, it is applied just locally (e.g., private tool). Module will not be distributed at all',
          value: 'D_never'}
      ]
    }
  },

  CA: {
    label: 'Some licenses may restrict commercialization options, others require different obligations depending on ' +
    'the type of commercialization model you select. So please indicate the intended commercial use.',
    type: String,
    optional: true,
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
    'inlude them with hardware or operate them for third parties. So please indicate the opeartional model.',
    type: String,
    optional: true,
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
    optional: true,
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
    optional: true,
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

export const LegalSettingsTemplateSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  type: {
    type: String,
    optional: true,
    allowedValues: ['project','module'],
    autoform: {
      type: 'select',
      afFieldInput: {
        placeholder: 'Select a type',
        allowClear: true
      },
      options: function () {
        return [{
          label:'Project',
          value:'project'
        },{
          label:'Module',
          value:'module'
        }]
      }
    }
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true,
    denyUpdate: true
  },
  name: {
    type: String,
    min: 3,
    max: 200
  },
  order: {
    type: Number,
    optional: true
  },
  requirements: {
    type: RequirementsObject,
    optional: true
  }
});
