/* global document:false */

import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Pluralize from 'pluralize';
import {Router} from 'meteor/vlasky:galvanized-iron-router';

function setPage(page) {
  Session.set('pageListNumber', page);
  if (Session.get('pageUri')) {
    let newUrl = Router.current().route.path({}, {
      ...Router.current().params,
      query: {
        ...Router.current().params.query,
        page
      }
    });
    Router.go(newUrl);
  }
}

Template.paginationList.onRendered(function () {
  const page = this.data.uri ? (Router.current().params.query || {}).page || 1 : 1;
  Session.set('pageListNumber', parseInt(page));
  Session.set('pageListSize', Session.get('pageListSize') || 25);
  Session.set('pageUri', this.data.uri);
});

/*
* TODO
* - for list details try to render info only item is opened
* */
Template.paginationList.helpers({
  page: function () {
    const pages =  Math.ceil(this.collection.length / Session.get('pageListSize'));
    const current = Session.get('pageListNumber');
    let arr = [];
    for (let i = 0; i < pages; i++) {
      arr.push(i+1);
    }
    return _.filter(arr,function (item) {
      return (item == +current) || (item == +current-1) ||
        (item == +current+1) || (item == +current-2) || (item == +current+2)
    });
  },
  isCurrent:function () {
    return (Session.get('pageListNumber') == this)?'active':''
  },
  currentPage:function () {
    const pages =  Math.ceil(this.collection.length / Session.get('pageListSize'));
    let page = Session.get('pageListNumber');
    if (page > pages) {
      page = pages === 0 ? 1 : pages;
      Session.set('pageListNumber', page);
    }
    return page;
  },
  total:function () {
    return this.collection.length
  },
  hasPrev:function () {
    return (Session.get('pageListNumber') > 1)?'page-prev':'disabled'
  },
  hasNext:function () {
    const pages =  Math.ceil(this.collection.length / Session.get('pageListSize'));
    return (Session.get('pageListNumber') < pages)?'page-next':'disabled'
  },
  sizeList:function () {
    return [5,10,25,50]
  },
  isCurrentSize:function () {
    return (Session.get('pageListSize') == this)?'active':''
  },
  pageSizeOrTotal:function () {
    const listSize = Session.get('pageListSize');
    if(this.list){
      return (this.list.length == listSize)?listSize:this.list.length
    }
  },
  getPluralized: function (text,list) {
    return list ? Pluralize(text, list.length || list, true) : ''
  },
  totalPages: function () {
    return Math.ceil(this.collection.length / Session.get('pageListSize')) || 1;
  },
  pageListSize: function () {
    return Session.get('pageListSize');
  },
  hasPrevCompact: function () {
    return Session.get('pageListNumber') > 1;
  },
  hasNextCompact: function () {
    const pages = Math.ceil(this.collection.length / Session.get('pageListSize'));
    return Session.get('pageListNumber') < pages;
  }
});

function toggleAll(selector){
  let checkboxes = document.getElementsByName(selector);
  for (let i = 0, n = checkboxes.length; i < n; i++) {
    checkboxes[i].checked = false;
  }
  let checkboxAll = document.getElementsByName('selectAll');
  checkboxAll[0].checked = false;

}

function resetFilter(){
  const currentState = Router.current().route.getName();
  if (currentState === 'moduleLicenses') {
    toggleAll('licenses');
  } else if (currentState === 'moduleComponents') {
    toggleAll('components');
  } else if (currentState === 'moduleDependencies') {
    toggleAll('components');
  }
}

Template.paginationList.events({
  'click .toggle-page .page': function (event) {
    event.preventDefault();
    setPage(parseInt($(event.target).attr('data-page')));
    resetFilter()
  },
  'click .page-prev': function (event) {
    event.preventDefault();
    setPage(Session.get('pageListNumber') - 1);
    resetFilter()
  },
  'click .page-next': function (event) {
    event.preventDefault();
    setPage(Session.get('pageListNumber') + 1);
    resetFilter()
  },
  'click .go-first': function (event) {
    event.preventDefault();
    setPage(1);
    resetFilter()
  },
  'click .go-last': function (event) {
    event.preventDefault();
    setPage(Math.ceil(this.collection.length / Session.get('pageListSize')));
    resetFilter()
  },
  'click .toggle-size .size': function (event) {
    event.preventDefault();
    Session.set('pageListSize',$(event.target).attr('data-size'));
    setPage(1);
    resetFilter()
  },
  'change .compact-size-input': function (event) {
    let val = parseInt($(event.target).val());
    if (val > 0) {
      Session.set('pageListSize', val);
      setPage(1);
      resetFilter();
    }
  },
  'change .compact-page-input': function (event) {
    let val = parseInt($(event.target).val());
    const pages = Math.ceil(this.collection.length / Session.get('pageListSize'));
    if (val >= 1 && val <= pages) {
      setPage(val);
      resetFilter();
    }
  },
  'click .compact-prev': function () {
    setPage(Session.get('pageListNumber') - 1);
    resetFilter();
  },
  'click .compact-next': function () {
    setPage(Session.get('pageListNumber') + 1);
    resetFilter();
  }
});
