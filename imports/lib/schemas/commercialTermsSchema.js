import {SimpleSchema} from 'meteor/aldeed:simple-schema';

const RADIO = 'select-radio'

export const CommercialTermsSchema = new SimpleSchema({
  RS: {
    label: 'Right to re-sell:',
    type: String,
    allowedValues: ['unlimited', 'limited', 'no'],
    autoform: {
      type: RADIO,
      options: [
        {
          label: 'Unlimited',
          value: 'unlimited'
        },
        {
          label: 'Limited',
          value: 'limited'
        },
        {
          label: 'No',
          value: 'no'
        }
      ]
    }
  },
  D: {
    label: 'Right to distribute:',
    type: String,
    allowedValues: ['unlimited', 'limited', 'no'],
    autoform: {
      type: RADIO,
      options: [
        {
          label: 'Unlimited',
          value: 'unlimited'
        },
        {
          label: 'Limited',
          value: 'limited'
        },
        {
          label: 'No',
          value: 'no'
        }
      ]
    }
  },
  SA: {
    label: 'Right to host/operate as SaaS:',
    type: String,
    allowedValues: ['unlimited', 'limited', 'no'],
    autoform: {
      type: RADIO,
      options: [
        {
          label: 'Unlimited',
          value: 'unlimited'
        },
        {
          label: 'Limited',
          value: 'limited'
        },
        {
          label: 'No',
          value: 'no'
        }
      ]
    }
  },
  M: {
    label: 'Right to modify:',
    type: String,
    allowedValues: ['unlimited', 'limited', 'no'],
    autoform: {
      type: RADIO,
      options: [
        {
          label: 'Unlimited',
          value: 'unlimited'
        },
        {
          label: 'Limited',
          value: 'limited'
        },
        {
          label: 'No',
          value: 'no'
        }
      ]
    }
  }
});
