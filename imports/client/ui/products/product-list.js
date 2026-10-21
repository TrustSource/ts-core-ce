/* global Blob:false, document: false, swal: false, window: false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Products from '/imports/lib/collections/products';
import Notify from '/imports/api/notify';

// Top-level products: those without a parent, and those whose parent does not
// exist (an import could leave such a product, which the tree never showed).
function rootFilter() {
  const identifiers = Products.find({}, {fields: {identifier: 1}}).map((product) => product.identifier);
  return {$or: [{parentId: {$in: [null]}}, {parentId: {$nin: identifiers}}]};
}

Template.productList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  Session.set('selectedTreeVisibility', 'active');
  Session.set('selectedTreeLevel', 'collapsed');

  // Auto-open first product if none selected
  this.autorun(() => {
    const query = Router.current().params.query || {};
    if (!query.identifier) {
      const first = Products.findOne(
        Object.assign(rootFilter(), {retired: {$in: [null]}}),
        {sort: {name: 1}}
      );
      if (first) {
        Router.go(Router.current().route.getName(), {}, {
          query: {identifier: first.identifier}
        });
      }
    }
  });
});

Template.productList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});


Template.productList.events({
  'click .actions a': function (event) {
    event.preventDefault();
    let target = $(event.target).closest('a');
    if (target.hasClass('collapse-all')) {
      Session.set('selectedTreeLevel', 'collapsed');
    } else {
      Session.set('selectedTreeLevel', 'expanded');
    }
    target.closest('.actions').find('.btn').toggleClass('hidden');
  },
  'click .actions-visibility a': function (event) {
    event.preventDefault();
    let target = $(event.target).closest('a');
    if (target.hasClass('show-all')) {
      Session.set('selectedTreeVisibility', 'all');
    } else {
      Session.set('selectedTreeVisibility', 'active');
    }
    target.closest('.actions-visibility').find('.btn').toggleClass('hidden');
  },
  'click .export-products': function () {
    Meteor.callAsync('Products.Export', {}).then(function(data) {
      let blob = new Blob([JSON.stringify(data, null, 2)]);
      if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
        window.navigator.msSaveBlob(blob, 'products-export.json');
      else{
        let a = window.document.createElement('a');
        a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
        a.download = 'products-export.json';
        document.body.appendChild(a);
        a.click();  // IE: "Access is denied";
        // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
        document.body.removeChild(a);
      }
    });
  },
  'click .remove-drafts': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    swal({
      title: 'Are you sure you want to remove draft products?',
      html: true,
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, remove it!'
    }, function () {
      Meteor.callAsync('Products.RemoveDrafts').then(function() {
        Meteor.callAsync('logEvent', currUser, 'Success', 'productDraftsRemoved');
      }).catch(function(error) {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'productDraftsRemoved');
      });
    });
  }
});


Template.productList.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  currentProduct: function () {
    let currentProduct = Router.current().params.query.identifier
    return currentProduct && Products.findOne({identifier: currentProduct});
  },
  tree: function () {
    let filter = Object.assign(rootFilter(), {
      retired: { $in: [null] }
    })
    if(Session.get('selectedTreeVisibility') === 'all'){
      delete filter.retired
    }
    return Products.find(filter);
  },
  productsCount: function () {
    let filter = {
      retired: { $in: [null] }
    }
    if(Session.get('selectedTreeVisibility') === 'all'){
      delete filter.retired
    }
    return Products.find(filter).count();
  },
  rootCount: function () {
    let filter = Object.assign(rootFilter(), {
      retired: { $in: [null] }
    })
    if(Session.get('selectedTreeVisibility') === 'all'){
      delete filter.retired
    }
    return Products.find(filter).count();
  },
  retiredCount: function () {
    return Products.find({
      retired: { $nin: [null] }
    }).count();
  },
  draftCount: function () {
    return Products.find({
      draft: true
    }).count();
  }
});

Template.productListItem.onCreated(function () {
  this.isOpenedFolder = new ReactiveVar(false);
});


Template.productListItem.events({
  'click .open_folder': function (event, instance) {
    event.preventDefault();
    event.stopPropagation();
    // Only handle if this click is on our own template's first .product-tree-item
    const ownItem = instance.$('> .product-tree-item')[0] || instance.$('.product-tree-item')[0];
    if (ownItem && !ownItem.contains(event.target)) return;
    instance.isOpenedFolder.set(!instance.isOpenedFolder.get());
  },
  'click .product-tree-item': function (event, instance) {
    event.preventDefault();
    event.stopPropagation();
    if ($(event.target).closest('.open_folder').length) return;
    // Only handle if this click is on our own template's first .product-tree-item
    const ownItem = instance.$('> .product-tree-item')[0] || instance.$('.product-tree-item')[0];
    if (ownItem && !ownItem.contains(event.target)) return;

    let query = Router.current().params.query || {};
    query.identifier = this.identifier;
    Router.go(Router.current().route.getName(), {}, {
      query: query
    });
  }
});

Template.productListItem.helpers({
  indentPadding: function () {
    let depth = 0;
    let node = this;
    while (node && node.parentId) {
      node = Products.findOne({identifier: node.parentId}, {fields: {parentId: 1}});
      if (node) depth++;
    }
    return 12 + depth * 28;
  },
  getProductsByParent: function () {
    let filter = {
      parentId: this.identifier,
      retired: { $in: [null] }
    }
    if(Session.get('selectedTreeVisibility') === 'all'){
      delete filter.retired
    }
    return Products.find(filter);
  },
  getChildrenCount: function () {
    let filter = {
      parentId: this.identifier,
      retired: { $in: [null] }
    }
    if(Session.get('selectedTreeVisibility') === 'all'){
      delete filter.retired
    }
    return Products.find(filter).count();
  },
  isFolderOpened: function () {
    const template = Template.instance();
    return Session.get('selectedTreeLevel') === 'expanded' || template.isOpenedFolder.get()
  },
  isActiveProductClass: function () {
    return Router.current().params.query.identifier === this.identifier ? 'active': ''
  }
});
