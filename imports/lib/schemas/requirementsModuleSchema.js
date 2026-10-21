import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const RequirementsSchema = new SimpleSchema({

  TS: {
    label: 'Trade Secret Protection',
    type: String,
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
  }

});

export const QuestionnaireSchemaStepOne = new SimpleSchema({

  TS: {
    label: 'Trade Secret Protection',
    type: String,
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
  }

});

export const QuestionnaireSchemaStepTwo = new SimpleSchema({

  LS: {
    label: 'Sub-licensing alert',
    type: String,
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
  }

});

export const QuestionnaireSchemaStepThree = new SimpleSchema({

  D: {
    label: 'If you plan to distribute your solution, it might lead to different obligations. ' +
    'So please indicate below which is the intended purpose or application of this module. ' +
    'TrustSource will resolve the obligations accordingly:',
    type: String,
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
  }

});