import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import TestTools from '/imports/lib/collections/testTools';

const FROM_UPPER = 'from-upper'

Template.qualitySettingsList.onRendered(function () {
  this.autorun(function () {
    Session.set('getToolsSettings', TestTools.find().fetch() || []);
  });
  Meteor.setTimeout(()=>{
    $('select.select2').select2({
      placeholder: '',
      width: '100%'
    });
  }, 100)
  const template = Template.instance();
  $('#addQualitySettingsForm').validate({
    rules: {
      addTool: {
        required: true
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (form) {
      const toolId = $(form).find('[name=addTool]').val();
      let list = Session.get('getToolsSettings');
      const toolName = list.find((item)=>item._id === toolId).name;
      if(!toolName){
        Notify.warn('Test tool is required');
      }else {
        const self = template.data;
        const allData = Session.get('getQualitySettingsList') || []
        const item = {
          name: toolName,
          toolId: toolId
        }
        if(self.id === 'moduleCmpQualitySettings'){
          item.moduleId = self.docId;
        }else if(self.id === 'projCmpQualitySettings'){
          item.projectId = self.docId;
        }
        allData.push(item)
        Meteor.callAsync('QualityProperties.Create', item);
        Session.set('getQualitySettingsList', allData);
        $(form).find('[name=addTool]').val([]).trigger('change');
      }
    }
  });
});

Template.qualitySettingsList.helpers({
  getTools: function () {
    let list = Session.get('getToolsSettings');
    if(list){
      list.unshift({_id:''})
      return list
    }else{
      return []
    }
  },
  getTool: function (name) {
    let list = Session.get('getToolsSettings');
    if(list){
      return list.find(item => {
        return item.name === name;
      })
    }else{
      return {
        name
      }
    }
  },
  getList: function () {
    const data = Template.currentData();
    return data && data.data;
  },

  isFromProject: function () {
    return this.projectItem ? FROM_UPPER : ''
  },

  isFromCompany: function () {
    return this.companyItem ? FROM_UPPER : ''
  },

  getProjectOptions: function () {
    return {
      projectId: Router.current().params.projectId
    };
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});
Template.qualitySettingsList.events({
  'click .remove-tool': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    const allData = Session.get('getQualitySettingsList')
    if (allData instanceof Array) {
      const dataWithout = _.reject(allData, function (elem) {
        return elem._id === self._id;
      }) || [];
      Meteor.callAsync('QualityProperties.Remove', self._id).then(function() {
        Notify.success('Successfully removed');
      }).catch(function(error) {
        Notify.danger(error.reason || error.message || 'Could not remove');
      });
      Session.set('getQualitySettingsList', dataWithout);
    }
  }
});
