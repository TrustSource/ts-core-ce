import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Component from '/imports/lib/component/Component';
import Utils from '/imports/lib/utils';

Template.componentSelector.onRendered(function () {
  this.autorun(function () {
    Session.set('selectComponent')
    Session.set('customComponent')
  });
});

Template.componentSelector.events({
  'click .scroll-to': function (event) {
    event.preventDefault();
    $('html,body').animate({scrollTop:0},0);
    $('input[name="name"]').focus();
  }
});

Template.componentSelector.helpers({

  components: function () {
    let type = 'components'
    let params = {name: Session.get('componentListFilter')}
    let extendedFilter = Session.get('filterSettings' + type)
    if(extendedFilter){
      try {
        params = JSON.parse(extendedFilter)
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (_e) { /* intentionally ignored */ }
    }
    let extendedSorting = Session.get('sortingSettings' + type)
    if(extendedSorting){
      extendedSorting = JSON.parse(extendedSorting)
    }
    let list =  ReactiveMethod.call('searchComponentsByFields',params, extendedSorting)
    if(list && list.length){
      list = _.map(list, function(doc){
        let item = new Component(doc)
        item._id = doc._id
        return item;
      })
    }
    return list
  },

  hasMore: function (components) {
    return components && components.length === 15
  },

  noResults: function (components) {
    return components && components.length === 0
  },
  isComponentSelected: function () {
    return Session.get('selectComponent')
  },
  isVersionSelected: function () {
    return Session.get('customComponent')
  },
  pkgTypes: function () {
    return Utils.getAllowedPackageTypes
  },
  selectedVersions: function () {
    let type = 'versions'
    let extendedFilter = Session.get('filterSettings' + type)
    if(extendedFilter){
      extendedFilter = JSON.parse(extendedFilter)
    }
    let component = Session.get('selectComponent')
    return component && component.versions.filter((version)=>{
      if(!extendedFilter || (extendedFilter && !extendedFilter.name)){
        return version
      }else{
        const filter = extendedFilter && extendedFilter.name
        return version.version.indexOf(filter) > -1
      }
    })
  }
});

