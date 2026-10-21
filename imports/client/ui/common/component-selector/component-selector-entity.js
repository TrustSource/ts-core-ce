import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import Company from '/imports/lib/company/Company';
import {Meteor} from 'meteor/meteor';
import Notify from '/imports/api/notify';


Template.componentSelectorEntity.helpers({
  isComponentBlacklisted: function () {
    const company = Session.get('company')
    const companyClass = new Company(company);
    return companyClass.isComponentBlacklisted(this.getKey(), '*')
  }
});
Template.componentSelectorEntity.events({

  'click .pick_component': function () {
    const component = {
      'name' : this.getName(),
      'key' : this.getKey(),
      'description' : this.getDescription(),
      'versions' : this.getVersions(),
      'homepageUrl' : this.getUrl('homepage') || null,
      'repoUrl' : this.getUrl('repository') || null,
      'dependencies' : []
    }
    Meteor.callAsync('getComponentVersions', this._id).then(function(data) {
      component.versions = data
      Session.set('selectComponent', component);
    }).catch(function(error) {
      Notify.danger('Error: '+ (error.reason));
    })
  }
});

