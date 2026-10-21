/* eslint-disable no-useless-escape */
import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const BWCveEntrySchema = new SimpleSchema({
  cveKey: {
    label: 'CVE key',
    type: String,
    min: 1,
    max: 250
  },
  key: {
    type: String,
    min: 1,
    max: 250
  },
  version: {
    type: String,
    min: 1,
    max: 20,
    regEx: /^(?:[A-Za-z0-9_\.-]+|[A-Za-z0-9_\.-]*\*)$/
  },
  path: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    min: 1,
    max: 200
  }
});

export const BWObligationEntrySchema = new SimpleSchema({
  obligationKey: {
    label: 'Obligation key',
    type: String,
    min: 1,
    max: 250
  },
  key: {
    type: String,
    min: 1,
    max: 250,
    optional: true
  },
  version: {
    type: String,
    min: 1,
    max: 20,
    regEx: /^(?:[A-Za-z0-9_\.-]+|[A-Za-z0-9_\.-]*\*)$/,
    optional: true
  },
  path: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    min: 1,
    max: 200
  }
});

export const BWLegalRulesEntrySchema = new SimpleSchema({
  ruleKey: {
    label: 'Rule key',
    type: String,
    min: 1,
    max: 250
  },
  key: {
    type: String,
    min: 1,
    max: 250,
    optional: true
  },
  version: {
    type: String,
    min: 1,
    max: 20,
    regEx: /^(?:[A-Za-z0-9_\.-]+|[A-Za-z0-9_\.-]*\*)$/,
    optional: true
  },
  path: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    min: 1,
    max: 200
  }
});

export const BWLicenseEntrySchema = new SimpleSchema({
  key: {
    label: 'License',
    type: String,
    min: 1,
    max: 250
  },
  comment: {
    type: String,
    min: 1,
    max: 200
  },
  notApproved: {
    type: Boolean,
    optional: true
  }
});

export const BWComponentEntrySchema = new SimpleSchema({
  key: {
    type: String,
    min: 1,
    max: 250
  },
  version: {
    type: String,
    min: 1,
    max: 20,
    regEx: /^(?:[A-Za-z0-9_\.-]+|[A-Za-z0-9_\.-]*\*)$/
  },
  path: {
    type: String,
    optional: true
  },
  status: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    min: 1,
    max: 200
  }
});
