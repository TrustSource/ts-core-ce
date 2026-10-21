/* global Typeahead:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';
import reportImpactAlgorithmService from '/imports/lib/reports/reportImpactAlgorithmService';
import Projects from '/imports/lib/collections/projects';

let findAlgorithms = function (query, callback, asyncResults) {
  Meteor.callAsync('findAlgorithms', query).then(function(data) {
    asyncResults(data.map(function(it){
      return {value: `${it.Algorithm} [${it.Strength}]`, algorithm: it, id: it.Algorithm};
    }))
  });
};

let selectedAlgorithms = function (e, payload) {
  let algorithm = payload.algorithm;
  Session.set('currentAlgorithm',{
    '_id' : payload.id,
    'Algorithm' : algorithm.Algorithm,
    'Strength' : algorithm.Strength
  });
};

Template.reportImpactAlgorithm.onRendered(function () {
  this.$('.typeahead').typeahead({
    hint: true,
    minLength: 1,
    highlight: true
  },{
    name: 'components',
    displayKey: 'value',
    valueKey: 'id',
    templates: {
      empty: Typeahead.compile('suggestionNoAlgorithms'),
      suggestion: Typeahead.compile('componentSuggestion')
    },
    limit: 10,
    source: _.debounce(findAlgorithms, 150)
  });
  this.$('.typeahead').on('typeahead:selected', selectedAlgorithms);
  const query = Router.current().params.query;
  if(query.key){
    let params = {
      'Algorithm' : query.key,
      'Strength' : query.strength
    }
    Session.set('currentAlgorithm',params);
    Session.set('requestInProgress', true);
    Meteor.callAsync('getImpactAlgorithm', params).then(function(data) {
      Session.set('requestInProgress');
      Session.set('reportImpactAlgorithm', data)
    })
  }else{
    Session.set('requestInProgress');
    Session.set('reportImpactAlgorithm');
    Session.set('currentAlgorithm');
  }
});

Template.reportImpactAlgorithm.events = {
  'click .export-as-pdf': function () {
    let reportData = Session.get('reportImpactAlgorithm');
    let report = reportImpactAlgorithmService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.algorithm.Algorithm+'-algorithm-impact.pdf');
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
    Session.set('currentAlgorithm')
    Session.set('reportImpactAlgorithm')
    $('#algorithmImpactForm').find('input').val('');
  },
  'submit #algorithmImpactForm': function (event) {
    event.preventDefault();
    if(Session.get('currentAlgorithm')){
      Session.set('requestInProgress', true);
      Session.set('reportImpactAlgorithm')
      Meteor.callAsync('getImpactAlgorithm', Session.get('currentAlgorithm')).then(function(data) {
        Session.set('requestInProgress');
        Session.set('reportImpactAlgorithm', data)
      })
    }else{
      Notify.warn('Algorithm is not selected');
    }
  }
};
Template.reportImpactAlgorithm.helpers({
  noData: function () {
    let data = Session.get('reportImpactAlgorithm');
    return data && data.list && data.list.length === 0  && !Session.get('requestInProgress')
  },
  getProject: function () {
    let data = Session.get('reportImpactAlgorithm');
    return data && data.list
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  },
  beforeRequest: function () {
    return !Session.get('reportImpactAlgorithm') && !Session.get('requestInProgress')
  },
  currentAlgorithm: function () {
    return Session.get('currentAlgorithm')
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
  algorithmDetails: function () {
    let data = Session.get('reportImpactAlgorithm');
    if(data && data.algorithm){
      return data.algorithm
    }else{
      return Session.get('currentAlgorithm')
    }
  },
  isDenied: function () {
    const company = Session.get('company');
    let self = this
    if(company && company.blacklistedAlgorithms && company.blacklistedAlgorithms.length){
      return company.blacklistedAlgorithms.some(algorithm => {
        if(!algorithm.key || !self.Algorithm){
          return false;
        }
        return algorithm.key.toLowerCase() === self.Algorithm.toLowerCase();
      })
    }else{
      return false
    }
  }
});
