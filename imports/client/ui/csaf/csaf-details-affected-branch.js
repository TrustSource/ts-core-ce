import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {setNestedValue, getNestedValue, addToArray, removeFromArray} from '/imports/lib/json';


Template.csafProductTreeBranch.onCreated(function () {
  this.jsonData = new ReactiveVar({});
});

Template.csafProductTreeBranch.onRendered(function () {
  const instance = this;
  this.autorun(function () {
    const data = Template.currentData();
    if(data){
      instance.jsonData.set(data.data);
    }
  });
});

Template.csafProductTreeBranch.events({
  '.csaf-branch input, change': function (event, instance) {
    event.stopPropagation();
    const path = event.currentTarget.getAttribute('data-path');
    const value = (event.currentTarget.type === 'checkbox')
      ? event.currentTarget.checked
      : event.currentTarget.value;
    const data = instance.jsonData.get();
    setNestedValue(data, path, value);
    instance.jsonData.set(data);
  },
  'click .add_branch_item': function (event, instance) {
    event.stopPropagation();
    const dataRoot = instance.jsonData.get();
    const path = event.currentTarget.getAttribute('data-path');
    const defaultItem = event.currentTarget.getAttribute('data-default-item');
    const items = {
      branches: {
        name: 'New item',
        category: 'product_version',
        branches: []
      }
    }
    addToArray(dataRoot, path, items[defaultItem]);
    instance.jsonData.set(dataRoot);
  },
  'click  .remove_branch_item': function (event, instance) {
    event.stopPropagation();
    const dataRoot = instance.jsonData.get();
    const path = event.currentTarget.getAttribute('data-path');
    const index = parseInt(event.currentTarget.getAttribute('data-index'), 10);
    const data = instance.jsonData.get();
    removeFromArray(dataRoot, path, index);
    instance.jsonData.set(data);
  }
});

Template.csafProductTreeBranch.helpers({
  getValue: function (path) {
    const data = Template.instance().jsonData.get();
    return getNestedValue(data, path);
  },
  hasData: function () {
    const data = Template.instance().jsonData.get();
    return data && data.category;
  },
  hasBranches: function () {
    const data = Template.instance().jsonData.get();
    return data && data.branches && data.branches.length;
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
