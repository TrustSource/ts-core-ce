 
import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const CIARequirementsSchema = new SimpleSchema({

  CR: {
    label: 'Confidentiality requirement (CR)',
    type: String,
    allowedValues: ['X', 'M', 'L', 'H'],
    autoform: {
      type: 'select',
      defaultValue: 'X',
      options: [
        {label: 'not defined',
          value: 'X'},
        {label: 'low',
          value: 'L'},
        {label: 'medium',
          value: 'M'},
        {label: 'high',
          value: 'H'}
      ]
    }
  },
  IR: {
    label: 'Integrity requirement (IR)',
    type: String,
    allowedValues: ['X', 'M', 'L', 'H'],
    autoform: {
      type: 'select',
      defaultValue: 'X',
      options: [
        {label: 'not defined',
          value: 'X'},
        {label: 'low',
          value: 'L'},
        {label: 'medium',
          value: 'M'},
        {label: 'high',
          value: 'H'}
      ]
    }
  },
  AR: {
    label: 'Availability requirement (AR)',
    type: String,
    allowedValues: ['X', 'M', 'L', 'H'],
    autoform: {
      type: 'select',
      defaultValue: 'X',
      options: [
        {label: 'not defined',
          value: 'X'},
        {label: 'low',
          value: 'L'},
        {label: 'medium',
          value: 'M'},
        {label: 'high',
          value: 'H'}
      ]
    }
  }

});
