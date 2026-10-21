import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';


function updateAnalysis(reload, analysis) {
  Meteor.callAsync('getModuleAnalysis', Router.current().params.moduleId).then(function(result) {
    Session.set('moduleAnalysis', result);
    if(reload){
      let analysisItem = {};
      if(analysis){
        analysisItem = _.find(result,function (item) {
          return item._id === analysis
        });
      }
      let analysisId = (analysisItem && analysisItem._id) || (result && result[0] && result[0]._id)
      Router.go(Router.current().route.getName(), {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId
      },{
        query:{
          analysis: analysisId
        }
      });
    }
  }).catch(function(error) {
    console.log(error);
    Session.set('moduleAnalysis', null);
  });
}

function initFreezeForm() {
  $('#freezeModuleForm').validate({
    rules: {
      moduleRelease: {
        required: true,
        minlength: 1,
        maxlength: 30
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
      const tagName = $(form).find('[name=moduleRelease]').val()
      const moduleId = Router.current().params.moduleId
      const analysisId = Router.current().params.query.analysis
      Meteor.callAsync('Analysis.AssignTag', {tagName, moduleId, analysisId}).then(function() {
        const message = 'New name ' + tagName + ' assigned to analysis';
        Notify.success(message);
        Session.set('newRelease', tagName);
        Meteor.setTimeout(function () {
          updateAnalysis(true, analysisId);
          $('#freezeModule').modal('hide');
        }, 300);
      }).catch(function(error) {
        const message = 'Internal Error: ' + (error.reason || 'could not assign tag');
        Notify.danger(message);
      });
    }
  });
}

Template.moduleFreeze.onRendered(function () {
  initFreezeForm();
});

$(document).on('shown.bs.modal', '#freezeModule', function () {
  initFreezeForm();
  $('#freezeModuleForm').validate().resetForm();
  $(this).find('[name=moduleRelease]').val('').removeClass('error');
});

Template.moduleFreeze.helpers({
  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});
