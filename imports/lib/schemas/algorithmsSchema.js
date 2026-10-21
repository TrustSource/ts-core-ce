 
import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const AlgorithmsConfig = new SimpleSchema({
  key: {
    label: 'Algorithm',
    type: String,
    min: 1,
    max: 250
  },
  strength: {
    label: 'Strength',
    type: String,
    min: 1,
    max: 250
  },
  importStrict: {
    type: [String]
  },
  importWeak: {
    type: [String]
  },
  importIrrelevant: {
    type: [String]
  },
  exportStrict: {
    type: [String]
  },
  exportWeak: {
    type: [String]
  },
  exportIrrelevant: {
    type: [String]
  }
});
