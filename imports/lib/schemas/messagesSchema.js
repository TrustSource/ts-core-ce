import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const messagesSchema = new SimpleSchema({
  userId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  senderId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  senderName: {
    type: String,
    optional: true
  },
  companyId: {
    type: String,
    optional: true,
    denyUpdate: true
  },
  projectId: {
    type: String,
    optional: true
  },
  moduleId: {
    type: String,
    optional: true
  },
  approveId: {
    type: String,
    optional: true
  },
  componentKey: {
    type: String,
    optional: true
  },
  subject: {
    type: String,
    optional: true
  },
  message: {
    type: String
  },
  status: {
    type: String,
    optional: true
  },
  created: {
    type: Date
  },
  viewed: {
    type: Date,
    optional: true
  },
  updated: {
    type: Date,
    optional: true
  },
  folder: {
    type: String,
    optional: true,
    allowedValues: ['inbox','marked','trash'],
    autoform: {
      type: 'select',
      afFieldInput: {
        placeholder: 'Select a folder',
        allowClear: true
      },
      options: function () {
        return [{
          label:'Inbox',
          value:'inbox'
        },{
          label:'Marked',
          value:'marked'
        },{
          label:'Trash',
          value:'trash'
        }]
      }
    }
  },
  public: {
    type: Boolean,
    optional: true
  },
  type: {
    type: String,
    optional: true,
    allowedValues: ['changeComponentStatus','vulnerabilityIntroduced','resetComponentStatus', 'componentComment'
      , 'eventsNotifications', 'alarmsNotifications', 'newsNotifications'],
    autoform: {
      type: 'select',
      afFieldInput: {
        placeholder: 'Select a type',
        allowClear: true
      },
      options: function () {
        return [{
          label:'Change component status',
          value:'changeComponentStatus'
        },{
          label:'Reset component status',
          value:'resetComponentStatus'
        },{
          label:'New vulnerability introduced',
          value:'vulnerabilityIntroduced'
        },{
          label:'Component comment',
          value:'componentComment'
        },{
          label:'Events',
          value:'eventsNotifications'
        },{
          label:'Alarms',
          value:'alarmsNotifications'
        },{
          label:'News',
          value:'newsNotifications'
        }]
      }
    }
  }
});
