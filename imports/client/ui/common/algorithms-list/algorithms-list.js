import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import {ListHelper} from '/imports/client/ui/lib/ListHelper';
import _ from 'underscore';

const FROM_UPPER = 'from-upper'

Template.algorithmsList.onRendered(function () {
  Session.set('selectedLine')
  Meteor.callAsync('getCountries').then(data => {
    if(data){
      Session.set('getCountries',data);
    }
    Meteor.callAsync('getAlgorithms').then(data => {
      if(data){
        Session.set('getAlgorithms',data);
        Meteor.setTimeout(()=>{
          $('select.select2').select2({
            placeholder: '',
            width: '100%'
          });
        }, 100)
      }
    }).catch(function(error) {
      console.error('getAlgorithms failed:', error);
    })
  }).catch(function(error) {
    console.error('getCountries failed:', error);
  })
  const template = Template.instance();
  $('#addAlgorithmForm').validate({
    rules: {
      addAlgorithm: {
        required: true
      },
      importStrict: {
        required: false
      },
      importWeak: {
        required: false
      },
      importIrrelevant: {
        required: false
      },
      exportStrict: {
        required: false
      },
      exportWeak: {
        required: false
      },
      exportIrrelevant: {
        required: false
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (form) {
      const addAlgorithm = $(form).find('[name=addAlgorithm]').val();
      const parts = addAlgorithm.split('//')
      const key = parts && parts[0];
      const strength = parts && parts[1];
      const importStrict = $(form).find('[name=importStrict]').val();
      const importWeak = $(form).find('[name=importWeak]').val();
      const importIrrelevant = $(form).find('[name=importIrrelevant]').val();
      const exportStrict = $(form).find('[name=exportStrict]').val();
      const exportWeak = $(form).find('[name=exportWeak]').val();
      const exportIrrelevant = $(form).find('[name=exportIrrelevant]').val();
      const self = template.data;
      const allData = _.clone(self.data)
      const originalData = _.reject(allData, function (elem) {
        return elem.projectItem || elem.companyItem;
      });
      const item = {
        key,
        strength,
        importStrict,
        importWeak,
        importIrrelevant,
        exportStrict,
        exportWeak,
        exportIrrelevant
      }
      originalData.push(item)
      Meteor.callAsync('updateCollection', self.collection._name, self.docId, self.attribute, originalData, true, originalData);
      template.data.data.push(item)
      $(form).find('[name=addAlgorithm]').val([]).trigger('change');
      $(form).find('[name=importStrict]').val([]).trigger('change');
      $(form).find('[name=importWeak]').val([]).trigger('change');
      $(form).find('[name=importIrrelevant]').val([]).trigger('change');
      $(form).find('[name=exportStrict]').val([]).trigger('change');
      $(form).find('[name=exportWeak]').val([]).trigger('change');
      $(form).find('[name=exportIrrelevant]').val([]).trigger('change');
    }
  });
});

Template.algorithmsList.helpers({
  getAlgorithms: function () {
    return Session.get('getAlgorithms');
  },
  getCountries: function () {
    return Session.get('getCountries');
  },
  getList: function () {
    const data = Template.currentData();
    return data && data.data;
  },

  isFromProject: function () {
    return this.projectItem ? FROM_UPPER : ''
  },

  isFromUser: function () {
    return this.userItem ? FROM_UPPER : ''
  },

  isFromCompany: function () {
    return this.companyItem ? FROM_UPPER : ''
  },

  getProjectOptions: function () {
    return {
      projectId: Router.current().params.projectId
    };
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  selectedLine: function () {
    return Session.get('selectedLine');
  }
});
Template.algorithmsList.events({
  'click .remove-algorithm': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    const template = Template.instance();
    const settings = template.data;
    if (template.data.data instanceof Array) {
      const allData = _.clone(template.data.data)
      const originalData = _.reject(allData, function (elem) {
        return elem.projectItem || elem.companyItem;
      });
      const dataWithout = _.reject(originalData, function (elem) {
        return elem.key === self.key && elem.strength === self.strength;
      }) || [];
      Meteor.callAsync('updateCollection', settings.collection._name, settings.docId, settings.attribute, dataWithout, true, originalData);
      template.data.data = dataWithout;
    }
    ListHelper.clearSession(self.id);
  },
  'click .clickable-row': function (event) {
    event.preventDefault();
    const self = this;
    Session.set('selectedLine')
    Meteor.setTimeout(()=>{
      Session.set('selectedLine', self)
    },1)
  }
});
