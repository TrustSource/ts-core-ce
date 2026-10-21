import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';

const LOADING = 'loadingInProgress'

function setPage(page) {
  Session.set('itemListNumber', page);
  const template = Template.instance();
  const collection = (template.data && template.data.list) || Session.get(template.data.listVariable);
  if(collection[page-1]){
    Session.set(template.data.loadingVariable, true);
    Meteor.setTimeout(function () {
      Session.set(template.data.itemVariable, collection[page-1]._id);
      Session.set(template.data.loadingVariable);
      if(template.data.fetchTasks && Session.get(template.data.itemVariable)){
        Meteor.callAsync('Tasks.Find', {riskId: Session.get(template.data.itemVariable)}).then(function(result) {
          Session.set('riskEditTaskList', result);
        }).catch(function(error) {
          console.error('Tasks.Find failed:', error);
        })
      }
    }, 1)
  }
}

Template.InlineItemNavigation.onRendered(function () {
  // The dialog is rendered before an item is opened in it, so the position follows
  // the current item instead of being read once (it showed "0 / 4").
  this.autorun(() => {
    const data = Template.currentData() || {};
    const collection = data.list || Session.get(data.listVariable) || [];
    const itemId = Session.get(data.itemVariable);
    const page = _.findIndex(collection, function(item) { return item._id === itemId })
    if (page > -1) {
      Session.set('itemListNumber', page + 1)
    }
  });
});

Template.InlineItemNavigation.events({
  'click .page-prev': function (event) {
    event.preventDefault();
    setPage(Session.get('itemListNumber') - 1);
  },
  'click .page-next': function (event) {
    event.preventDefault();
    setPage(Session.get('itemListNumber') + 1);
  },
  'click .go-first': function (event) {
    event.preventDefault();
    setPage(1);
  },
  'click .go-last': function (event) {
    event.preventDefault();
    const template = Template.instance();
    const collection = (template.data && template.data.list) || Session.get(template.data.listVariable);
    setPage(collection.length);
  }
});

Template.InlineItemNavigation.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  currentPage: function () {
    return Math.max(1, Session.get('itemListNumber') || 1);
  },
  total: function () {
    const template = Template.instance();
    const collection = (template.data && template.data.list) || Session.get(template.data.listVariable);
    return collection.length;
  },
  hasPrev:function () {
    return (Session.get('itemListNumber') > 1)?'page-prev':'disabled'
  },
  hasNext:function () {
    const template = Template.instance();
    const collection = (template.data && template.data.list) || Session.get(template.data.listVariable);
    const pages = collection.length;
    return (Session.get('itemListNumber') < pages)?'page-next':'disabled'
  }
});
