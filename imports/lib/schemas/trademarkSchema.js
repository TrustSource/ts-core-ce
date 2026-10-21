import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const TrademarkSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  name: {
    type: String
  },
  type: {
    type: String,
    optional: true,
    allowedValues: ['copyright','trademark'],
    autoform: {
      type: 'select',
      afFieldInput: {
        placeholder: 'Select a type',
        allowClear: true
      },
      options: function () {
        return [{
          label:'Copyright',
          value:'copyright'
        },{
          label:'Trademark',
          value:'trademark'
        }]
      }
    }
  },
  description: {
    type: String,
    max: 2000,
    autoform: {
      type: 'textarea'
    },
    optional: true
  },
  usage: {
    type: String,
    max: 2000,
    autoform: {
      type: 'textarea'
    },
    optional: true
  },
  link: {
    type: String,
    optional: true
  }
});
