/* global document:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';
import CSAF from '/imports/lib/collections/csaf';
import {setNestedValue, getNestedValue, addToArray, removeFromArray} from '/imports/lib/json';


Template.csafDetailsRemediations.onCreated(function () {
  this.jsonData = new ReactiveVar({});
});


Template.csafDetailsRemediations.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  const instance = this;
  this.autorun(function () {
    const data = Template.currentData();
    if(data){
      instance.jsonData.set(data.data && JSON.parse(data.data));
    }
  });
});

Template.csafDetailsRemediations.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.csafDetailsRemediations.events({
  '.csaf_vulnerabilities input, change': function (event, instance) {
    const path = event.currentTarget.getAttribute('data-path');
    const value = (event.currentTarget.type === 'checkbox')
      ? event.currentTarget.checked
      : event.currentTarget.value;
    const data = instance.jsonData.get();
    setNestedValue(data, path, value);
    instance.jsonData.set(data);
  },
  'click .csaf_vulnerabilities .add_item': function (event, instance) {
    const dataRoot = instance.jsonData.get();
    const path = event.currentTarget.getAttribute('data-path');
    const defaultItem = event.currentTarget.getAttribute('data-default-item');
    const items = {
      vulnerabilities: {
        cve: 'New CVE'
      }
    }
    addToArray(dataRoot, path, items[defaultItem]);
    instance.jsonData.set(dataRoot);
  },
  'click .csaf_vulnerabilities .remove_item': function (event, instance) {
    const dataRoot = instance.jsonData.get();
    const path = event.currentTarget.getAttribute('data-path');
    const index = parseInt(event.currentTarget.getAttribute('data-index'), 10);
    const data = instance.jsonData.get();
    removeFromArray(dataRoot, path, index);
    instance.jsonData.set(data);
  },
  'click .collapse-action': function (event) {
    const action = $(event.target).closest('.collapse-action');
    $(action).next('.panel-body').toggleClass('hidden');
  },
  'click .discard_changes:not([disabled])': function (event, instance) {
    event.preventDefault();
    Session.set('requestInProgress', true);
    const params = Router.current().params
    const doc = CSAF.findOne({_id:params.csafId})
    instance.jsonData.set(doc && doc.data && JSON.parse(doc.data));
    Session.set('requestInProgress');
  },
  'click .save_changes:not([disabled])': function (event) {
    event.preventDefault();
    $('#csafDetailsRemediations').submit();
  },
  'submit #csafDetailsRemediations': function (event, instance) {
    event.preventDefault();
    const self = this;
    const newData = JSON.stringify(instance.jsonData.get());
    Session.set('requestInProgress', true);
    Meteor.callAsync('CSAF.Validate', {file: newData}).then(function() {
      Meteor.callAsync('CSAF.Update', {$set: {data: newData}}, self._id).then(function() {
        Notify.success('CSAF ' + self.name + ' has been updated');
      }).catch(function(error) {
        Notify.danger(error.message);
      }).finally(function() {
        Session.set('requestInProgress');
      })
    }).catch(function(error) {
      Notify.danger(error.message);
      Session.set('requestInProgress');
    })
  }
});

Template.csafDetailsRemediations.helpers({
  getValue: function (path) {
    const data = Template.instance().jsonData.get();
    return getNestedValue(data, path);
  },
  hasData: function () {
    const data = Template.instance().jsonData.get();
    return data && data.document;
  },
  getRoot: function () {
    return Template.parentData()
  },
  withParentContext: function (parentIndex, array) {
    return array && array.map((item) => ({
      value: item,
      parentIndex
    }));
  },
  isEditDisabled: function () {
    return false
  },
  isLoading: function () {
    return Session.get('requestInProgress');
  },
  isSelected: function (item, value) {
    return item === value;
  }
});
