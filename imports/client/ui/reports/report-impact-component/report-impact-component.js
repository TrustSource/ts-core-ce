/* global Typeahead:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';
import reportImpactComponentService from '/imports/lib/reports/reportImpactComponentService';
import Component from '/imports/lib/component/Component';
import Projects from '/imports/lib/collections/projects';

let searchComponents = function (query, callback, asyncResults) {
  Meteor.callAsync(
    'searchComponentsByFields',
    {name: query},
    false,
    {_id:true, name:true, key:true,
      urls: true, versions:true, description:true }
  ).then(function(data) {
    asyncResults(data.map(function(it){
      return {value: it.name, component: new Component(it), id: it._id};
    }))
  });
};

let selectedComponent = function (e, payload) {
  let component = payload.component;
  Session.set('currentComponent',{
    '_id' : payload.id,
    'name' : component.getName(),
    'key' : component.getKey(),
    'description' : component.getDescription(),
    'versionsList' : component.data().versions
  });
  Session.set('currentVersion');
  $('#currentVersion').val('').trigger('change');
};

Template.reportImpactComponent.onRendered(function () {
  this.$('.typeahead').typeahead({
    hint: true,
    minLength: 1,
    highlight: true
  },{
    name: 'components',
    displayKey: 'value',
    valueKey: 'id',
    templates: {
      empty: Typeahead.compile('suggestionNoComponents'),
      suggestion: Typeahead.compile('componentSuggestion')
    },
    limit: 15,
    source: _.debounce(searchComponents, 150)
  });

  this.$('.typeahead').on('typeahead:selected', selectedComponent);
});

Template.reportImpactComponent.onRendered(function () {
  Session.set('requestInProgress');
  Session.set('reportImpactComponent');
  Session.set('currentComponent');
  Meteor.setTimeout(function () {
    $('.select2').select2({width: '100%'});
  },1)
});

Template.reportImpactComponent.events = {
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportImpactComponent');
    let report = reportImpactComponentService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.component.name+'-component-impact.pdf');
    }catch (error){
      console.log(error)
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  },
  'click .reset_view': function () {
    $('.form-inline').validate().resetForm();
    Session.set('currentComponent')
    Session.set('reportImpactComponent')
    $('#componentImpactForm').find('input').val('');
    Meteor.setTimeout(function () {
      $('.select2').select2({width: '100%'});
    },1)
  },
  'submit #componentImpactForm': function (event) {
    event.preventDefault();
    if(Session.get('currentComponent')){
      Session.set('requestInProgress', true);
      Meteor.callAsync('getImpactComponent', Session.get('currentComponent')).then(function(data) {
        Session.set('requestInProgress', false);
        Session.set('reportImpactComponent', data)
      })
    }else{
      Notify.warn('Component is not selected');
    }
  },
  'click .send_alert': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    Meteor.callAsync('notifyAboutComponentImpact', user, Session.get('reportImpactComponent')).then(function() {
      Notify.success('Notification about component impact sent');
    }).catch(function(error) {
      Notify.danger('Error: ' + (error.reason || ' could not send notification'));
    })
  },
  'change #currentVersion': function (event) {
    const version = $(event.target).val();
    let versionObject = Session.get('currentComponent').versionsList.find(function (versionItem) {
      return versionItem.version === version
    });
    let component = Session.get('currentComponent');
    if(versionObject){
      component.version = version;
    }else{
      component.version = null;
    }
    Session.set('currentComponent',component);
  }
};
Template.reportImpactComponent.helpers({
  noData: function () {
    let data = Session.get('reportImpactComponent');
    return data && data.list && data.list.length === 0  && !Session.get('requestInProgress')
  },
  getProject: function () {
    let data = Session.get('reportImpactComponent');
    return data && data.list
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  },
  beforeRequest: function () {
    return !Session.get('reportImpactComponent') && !Session.get('requestInProgress')
  },
  isCurrentVersion: function (version) {
    let component = Session.get('currentComponent');
    return component.version === version
  },
  currentComponent: function () {
    return Session.get('currentComponent')
  },
  versions: function () {
    let component = Session.get('currentComponent');
    if (component && component.versionsList){
      Meteor.setTimeout(function () {
        $('.select2').select2({width: '100%'});
      },1)
    }
    return component ? component.versionsList : []
  },
  isUnasigned: function () {
    return Projects.UNASSIGNED === this._id;
  },
  haveDescription: function (description) {
    return description && description.length > 0
  },
  actionRoute: function () {
    const path = this;
    return {
      route: 'projectModules',
      params: {
        projectId: path._id || Projects.UNASSIGNED
      }
    }
  },
  componentDetails: function () {
    let data = Session.get('reportImpactComponent');
    return data.component
  }
});
