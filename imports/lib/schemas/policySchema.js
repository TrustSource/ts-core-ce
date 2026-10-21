import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import UserExtUtils from '/imports/lib/userExtUtils';

const PolicyNotified = new SimpleSchema({
  userId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  name: {
    type: String
  },
  confirmedDate: {
    type: Date,
    optional: true,
    autoform: {
      afFieldInput: {
        type: 'datetime'
      }
    }
  },
  viewedDate: {
    type: Date,
    optional: true,
    autoform: {
      afFieldInput: {
        type: 'datetime'
      }
    }
  },
  presentedDate: {
    type: Date,
    optional: true,
    autoform: {
      afFieldInput: {
        type: 'datetime'
      }
    }
  }
});

export const PolicySchema = new SimpleSchema({
  active: {
    type: Boolean,
    autoform: {
      afFieldInput: {
        type: 'switch'
      }
    }
  },
  name: {
    type: String,
    min: 3,
    max: 200
  },
  file: {
    type: String,
    autoform: {
      afFieldInput: {
        type: 'cfs-file',
        collection: 'policy'
      }
    }
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    denyUpdate: true
  },
  activeFromDate: {
    type: Date,
    autoform: {
      afFieldInput: {
        type: 'datetime'
      }
    }
  },
  creationDate: {
    type: Date,
    autoform: {
      afFieldInput: {
        type: 'datetime'
      }
    }
  },
  updatedDate: {
    type: Date,
    autoform: {
      afFieldInput: {
        type: 'datetime'
      }
    }
  },
  description: {
    type: String,
    label: 'Summary of changes',
    max: 2000,
    autoform: {
      type: 'textarea'
    },
    optional: true
  },
  notify: {
    type: Array,
    autoform: {
      type: 'select2',
      afFieldInput: {
        multiple: true
      },
      options: UserExtUtils.availableRolesWithValues()
    },
    optional: true
  },
  'notify.$': {
    type: String,
    allowedValues: UserExtUtils.availableRolesKeys(),
    optional: true
  },
  notified: {
    type: [PolicyNotified],
    optional: true
  }
});
