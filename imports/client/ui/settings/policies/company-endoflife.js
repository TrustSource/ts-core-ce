/* global swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import Companies from '/imports/lib/collections/companies';
import {EndoflifePolicy} from '/imports/lib/schemas/endoflifePolicySchema';
import Notify from '/imports/api/notify';
import {AutoForm} from 'meteor/aldeed:autoform';

Template.companyEndoflife.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  endoflifePolicy: function () {
    return this.endoflifePolicy
  },
  getCompanies: function (){
    return Companies
  },
  getEndoflifeSchema() {
    return EndoflifePolicy;
  }
});

Template.companyEndoflife.events({
  'click input[name="endoflifeConfigEnabled"]': function (event) {
    event.preventDefault();
    let self = this;
    swal({
      title: 'Are you sure you want to update end-of-life policy?',
      text: 'This will affect all future analysis!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#2a94a2',
      confirmButtonText: 'Yes, update settings!'
    }, async function () {
      const user = Meteor.user();
      const company = Companies.findOne({_id: self._id}, {
        fields: {
          name: true,
          endoflifePolicy: true
        }
      });
      let endoflifePolicy = company.endoflifePolicy || {};
      endoflifePolicy.enabled = !(company && company.endoflifePolicy && company.endoflifePolicy.enabled);
      try {
        await Meteor.callAsync('Companies.UpdateEndoflifePolicy', endoflifePolicy);
        Meteor.callAsync('logEvent', user, 'Company end-of-life policy changed', 'companyEndoflifePolicyUpdated');
        Notify.success('Company end-of-life policy successfully changed');
      } catch (error) {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, error.message, 'companyEndoflifePolicyUpdated');
      }
    });
  }
});

AutoForm.hooks({
  updateCompanyFormEndoflifeConfig: {
    onSubmit: function (insertDoc) {
      let self = this;
      insertDoc.enabled = true;
      Meteor.callAsync('Companies.UpdateEndoflifePolicy', insertDoc).then(function () {
        const user = Meteor.user();
        Meteor.callAsync('logEvent', user, 'Company end-of-life policy changed', 'companyEndoflifePolicyUpdated');
        Notify.success('Company end-of-life policy successfully changed');
        self.done();
      }).catch(function (error) {
        console.log('Error in onSubmit()', error);
        Notify.danger(error.message || 'Submission failed');
        self.done(new Error('Submission failed'));
      });
      return false;
    },
    onError: function (formType, error) {
      if (error && error.message) {
        Notify.danger(error.message);
      }
    }
  }
});

