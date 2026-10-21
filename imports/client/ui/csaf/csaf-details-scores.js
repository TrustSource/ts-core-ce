import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {setNestedValue, getNestedValue} from '/imports/lib/json';


Template.csafScores.onCreated(function () {
  this.jsonData = new ReactiveVar({});
});

Template.csafScores.onRendered(function () {
  const instance = this;
  this.autorun(function () {
    const data = Template.currentData();
    if(data){
      instance.jsonData.set(data.data);
    }
  });
});

Template.csafScores.events({
  '.csaf-scores input, change': function (event, instance) {
    event.stopPropagation();
    const path = event.currentTarget.getAttribute('data-path');
    const value = (event.currentTarget.type === 'checkbox')
      ? event.currentTarget.checked
      : event.currentTarget.value;
    const data = instance.jsonData.get();
    setNestedValue(data, path, value);
    instance.jsonData.set(data);
  }
});

Template.csafScores.helpers({
  getValue: function (path) {
    const data = Template.instance().jsonData.get();
    return getNestedValue(data, path);
  },
  hasData: function () {
    const data = Template.instance().jsonData.get();
    return data && (data.cvss_v2 || data.cvss_v3);
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
