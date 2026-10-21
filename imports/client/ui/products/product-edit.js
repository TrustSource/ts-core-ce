import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Products from '/imports/lib/collections/products';
import {initScrollableTabs, destroyScrollableTabs} from '/imports/client/ui/common/scrollable-tabs';

const LOADING = 'loadingInProgress'

Template.productEdit.onRendered(function () {
  Session.set('productCurrentTab', 'productGeneral');
  initScrollableTabs(this);
});

Template.productEdit.onDestroyed(function () {
  destroyScrollableTabs(this);
});

Template.productEdit.events({
  'click .set-active-view': function (event) {
    const view = $(event.target).attr('data-view') || $(event.target).parent().attr('data-view');
    Session.set('productCurrentTab', view);
  }
});

Template.productEdit.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  isSelected: function (item, value) {
    return item === value;
  },
  activeTab: function (tab) {
    const currentTab = Session.get('productCurrentTab');
    return currentTab === tab ? 'active-tab active' : '';
  },
  activeView: function (tab) {
    const currentTab = Session.get('productCurrentTab');
    return currentTab === tab
  },
  getBreadcrumb: function () {
    const chain = [];
    let node = this;
    while (node && node.parentId) {
      node = Products.findOne({ identifier: node.parentId },{ fields: { name: 1, parentId: 1 } });
      if (node) {
        chain.unshift(node.name);
      }
    }
    return chain.length ? `${chain.join(' / ')} / ` : ''
  }
});
