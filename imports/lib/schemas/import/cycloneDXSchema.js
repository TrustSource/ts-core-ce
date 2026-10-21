import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const CycloneDXSchema = new SimpleSchema({
  bomFormat: {
    type: String
  },
  specVersion: {
    type: String
  },
  serialNumber: {
    type: String,
    optional: true
  },
  version: {
    type: Number,
    optional: true
  },
  metadata: {
    type: Object,
    optional: true,
    blackbox: true
  },
  components: {
    type: Array,
    optional: true
  },
  'components.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  dependencies: {
    type: Array,
    optional: true
  },
  'dependencies.$': {
    type: Object,
    optional: true,
    blackbox: true
  }
});
