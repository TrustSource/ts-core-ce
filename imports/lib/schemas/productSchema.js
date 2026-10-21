import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const ProductPropertySchema = new SimpleSchema({
  name: {
    type: String
  },
  value: {
    type: String
  }
});

export const ProductCapabilitySchema = new SimpleSchema({
  name: {
    type: String
  },
  version: {
    type: String,
    optional: true
  },
  description: {
    type: String,
    optional: true
  }
});

export const ProductContactsSchema = new SimpleSchema({
  registeredTradeName: {
    type: String,
    optional: true
  },
  manufacturerName: {
    type: String,
    optional: true
  },
  manufacturerAddress: {
    type: String,
    optional: true
  },
  manufacturerWebsite: {
    type: String,
    optional: true
  },
  productSecurityContact: {
    type: String,
    optional: true
  },
  productSecurityWeblink: {
    type: String,
    optional: true
  }
});

export const ProductSolutionSchema = new SimpleSchema({
  _id: {
    type: String
  },
  name: {
    type: String
  },
  version: {
    type: String,
    optional: true
  },
  closedByName: {
    type: String,
    optional: true
  },
  capabilities:{
    type: [ProductCapabilitySchema],
    optional: true
  }
});

export const ProductSupportContractSchema = new SimpleSchema({
  _id: {
    type: String
  },
  name: {
    type: String
  },
  created: {
    type: Date
  },
  endDate: {
    type: Date,
    optional: true
  },
  description: {
    type: String,
    optional: true
  }
});

export const ProductMisuseSchema = new SimpleSchema({
  _id: {
    type: String
  },
  name: {
    type: String
  },
  created: {
    type: Date
  },
  description: {
    type: String,
    optional: true
  }
});

export const ProductFileSchema = new SimpleSchema({
  url: {
    type: String
  },
  name: {
    type: String
  },
  uploaded: {
    type: Date
  },
  uploadedBy: {
    type: String,
    optional: true
  },
  uploadedByName: {
    type: String,
    optional: true
  }
});

export const ProductDocumentsSchema = new SimpleSchema({
  userManual: {
    type: ProductFileSchema,
    optional: true
  },
  secureSetup: {
    type: ProductFileSchema,
    optional: true
  },
  productDescription: {
    type: ProductFileSchema,
    optional: true
  },
  sbom: {
    type: ProductFileSchema,
    optional: true
  },
  cedoc: {
    type: ProductFileSchema,
    optional: true
  },
  photos: {
    type: [ProductFileSchema],
    optional: true
  }
});

export const ProductSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  },
  draft: {
    type: Boolean,
    optional: true
  },
  submitted: {
    type: Date
  },
  companyId: {
    type: String
  },
  released: {
    type: Date,
    optional: true
  },
  releasedBy: {
    type: String,
    optional: true
  },
  releasedByName: {
    type: String,
    optional: true
  },
  updated: {
    type: Date,
    optional: true
  },
  updatedBy: {
    type: String,
    optional: true
  },
  updatedByName: {
    type: String,
    optional: true
  },
  retired: {
    type: Date,
    optional: true
  },
  retiredReason: {
    type: String,
    optional: true
  },
  retiredBy: {
    type: String,
    optional: true
  },
  retiredByName: {
    type: String,
    optional: true
  },
  parentId:{
    type: String,
    optional: true
  },
  type: {
    type: String
  },
  identifier: {
    type: String
  },
  name: {
    type: String,
    optional: true
  },
  description: {
    type: String,
    optional: true
  },
  features: {
    type: String,
    optional: true
  },
  state: {
    type: String,
    optional: true
  },
  started: {
    type: Date,
    optional: true
  },
  classification: {
    type: String,
    optional: true
  },
  properties: {
    type: [ProductPropertySchema],
    optional: true
  },
  solutions: {
    type: [ProductSolutionSchema],
    optional: true
  },
  contacts: {
    type: ProductContactsSchema,
    optional: true
  },
  supportContracts: {
    type: [ProductSupportContractSchema],
    optional: true
  },
  misuses: {
    type: [ProductMisuseSchema],
    optional: true
  },
  documents: {
    type: ProductDocumentsSchema,
    optional: true
  }
});
