import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {LegalSettingsTemplateSchema} from '/imports/lib/schemas/legalSettingsTemplateSchema';
import {AutoForm} from 'meteor/aldeed:autoform';
import Notify from '/imports/api/notify';


Template.companyLegalTemplatesDetails.onRendered(function () {
  $('#updateTemplateForm')[0].reset();
});

Template.companyLegalTemplatesDetails.helpers({

  getSchema: function () {
    return LegalSettingsTemplateSchema;
  },
  fields: function () {
    return 'order,name'
  },
  getName:function () {
    return '['+this.type+'] ' + this.name
  },
  isProject: function () {
    return this.type === 'project'
  }
});

AutoForm.hooks({
  updateTemplateForm: {
    before: {
      'method-update': function (doc) {
        this.event.preventDefault();
        return doc;
      }
    },
    after: {
      'method-update': function () {
        Notify.success('Template updated!');
      }
    }
  }
});
