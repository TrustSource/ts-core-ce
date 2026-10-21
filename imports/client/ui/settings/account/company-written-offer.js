import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

import Notify from '/imports/api/notify';

let defaultTitle = 'Open Source Announcement';
let defaultDescription = [
  'The software included in this product contains copyrighted software that is licensed under the GPL/LGPL.',
  '',
  'You may obtain the complete corresponding source code from us for a period of three years after our last shipment ' +
  'of this product. If you want to obtain the complete corresponding source code on a physical medium such as CD-ROM, ' +
  'the cost of physically performing source distribution may be charged, please include the shipping address to ' +
  'determine costs of delivery. This offer is valid to anyone in receipt of this information. You express such ' +
  'wish by sending an email to // a request by using the following form:',
  '',
  'some-alias@your-company.com //',
  'https://somewebsite-with-a-contact-form.your-comany.com'
].join('\n');

Template.companyWrittenOffer.events({
  'submit .written_offer': function (event) {
    event.preventDefault();
    let company = this;
    let form = $(event.target);
    const data = {
      writtenOffer: {
        title: form.find('[name=writtenOfferTitle]').val(),
        description: form.find('[name=writtenOfferDescription]').val()
      }
    };
    Meteor.callAsync('Companies.UpdateWrittenOffer', company._id, data).then(() => {
      const user = Meteor.user();
      Notify.success('Company settings updated');
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' settings changed', 'companySettingsUpdated');
    }).catch((error) => {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'companySettingsUpdated');
    });
  },
  'click .reset_written_offer': function (event) {
    event.preventDefault();
    let company = this;
    let form = $(event.target).parents('.writen_offer');
    form.find('[name=writtenOfferTitle]').val(defaultTitle);
    form.find('[name=writtenOfferDescription]').val(defaultDescription);
    const data = {
      writtenOffer: {
        title: defaultTitle,
        description: defaultDescription
      }
    };
    Meteor.callAsync('Companies.UpdateWrittenOffer', company._id, data).then(() => {
      const user = Meteor.user();
      Notify.success('Company settings updated');
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' settings changed', 'companySettingsUpdated');
    }).catch((error) => {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'companySettingsUpdated');
    });
  }
});

Template.companyWrittenOffer.helpers({
  writtenOfferTitle: function () {
    if(this.writtenOffer){
      return this.writtenOffer.title
    }else{
      return defaultTitle
    }
  },
  writtenOfferDescription: function () {
    if(this.writtenOffer){
      return this.writtenOffer.description
    }else{
      return defaultDescription
    }
  }
});
