 
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';

const FORM = '#RiskEditTaskForm'
const MODAL = '#RiskEditTaskModal'

function getData() {
  let state = Router.current().route.getName();
  if(state === 'risksTasks'){
    const moduleId = Router.current().params.query.moduleId
    const projectId = Router.current().params.query.projectId
    Meteor.callAsync('Tasks.FindByRisks', {moduleId, projectId}).then(function(data) {
      Session.set('riskTaskList', _.sortBy((data ? data : []), 'created').reverse());
    }).catch(function(error) {
      console.error('Tasks.FindByRisks failed:', error);
    });
  }else{
    Meteor.callAsync('Tasks.Find', {riskId: Session.get('editRiskDetails')}).then(function(result) {
      Session.set('riskEditTaskList', result);
    }).catch(function(error) {
      console.error('Tasks.Find failed:', error);
    })
  }
}

Template.riskEditTask.onRendered(function () {
  Session.set('WithNext');
  $('#RiskEditTaskForm').validate({
    rules: {
      task: {
        required: true
      },
      countermeasure: {
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
      const task = $(form).find('[name=task]').val();
      const due = $(form).find('[name=due]').val();
      const frequency = $(form).find('[name=frequency]').val();
      const countermeasure = $(form).find('[name=countermeasure]').val();
      const status = $(form).find('[name=status]').val();
      const comment = $(form).find('[name=comment]').val();
      const responsible = $(form).find('[name=responsible]').val();
      if(!task){
        Notify.warn('Task is required');
      }else if(!countermeasure){
        Notify.warn('Countermeasure is required');
      }else {
        const item = {
          task,
          countermeasure,
          frequency,
          due,
          status,
          comment,
          responsible,
          riskId : Session.get('editRiskDetails')
        }
        let current = Session.get('editTask');
        Meteor.callAsync('Tasks.Update', current._id, null, {$set:item}, null).then(() => {
          Notify.success('Task updated');
          getData()
          if(Session.get('WithNext')){
            $(FORM).validate().resetForm();
            $(FORM).find('[name=task]').val('').trigger('change');
            $(FORM).find('[name=countermeasure]').val('').trigger('change');
            $(FORM).find('[name=status]').val('').trigger('change');
            $(FORM).find('[name=comment]').val('').trigger('change');
            $(FORM).find('[name=frequency]').val('').trigger('change');
            $(FORM).find('[name=due]').val('').trigger('change');
            $(FORM).find('[name=responsible]').val([]).trigger('change');
          }else{
            $(MODAL).modal('hide');
          }
        }).catch(error => {
          const message = 'Error: ' + (error.reason || 'Task: ' + task + ' not updated');
          Notify.danger(message);
        });
      }
    }
  });
  this.autorun(function () {
    Meteor.setTimeout(function () {
      $('select.select2').select2({
        allowClear: true,
        width: '100%'
      });
    },1)
  });

  // Modals are moved to <body> on show (global handler) - Template.events
  // never fires inside. Bind delegated handlers on the modal element itself.
  $(MODAL).off('.riskEditTask')
    .on('submit.riskEditTask', FORM, function (event) {
      event.preventDefault();
    })
    .on('click.riskEditTask', '.without_next', function () {
      Session.set('WithNext');
    })
    .on('click.riskEditTask', '.with_next', function () {
      Session.set('WithNext', true);
    })
    .on('show.bs.modal.riskEditTask', function () {
      $(FORM).validate().resetForm();
      let item = Session.get('editTask');
      $(FORM).find('[name=task]').val(item.task).trigger('change');
      $(FORM).find('[name=countermeasure]').val(item.countermeasure).trigger('change');
      $(FORM).find('[name=status]').val(item.status).trigger('change');
      $(FORM).find('[name=comment]').val(item.comment).trigger('change');
      $(FORM).find('[name=frequency]').val(item.frequency).trigger('change');
      $(FORM).find('[name=due]').val(item.due).trigger('change');
      $(FORM).find('[name=responsible]').val(item.responsible).trigger('change');
      Meteor.setTimeout(function () {
        $('select.select2').select2({
          allowClear: true,
          width: '100%'
        });
      },1)
    })
    .on('hide.bs.modal.riskEditTask', function () {
      $(FORM).validate().resetForm();
      $(FORM).find('[name=task]').val('').trigger('change');
      $(FORM).find('[name=countermeasure]').val('').trigger('change');
      $(FORM).find('[name=status]').val('').trigger('change');
      $(FORM).find('[name=comment]').val('').trigger('change');
      $(FORM).find('[name=frequency]').val('').trigger('change');
      $(FORM).find('[name=due]').val('').trigger('change');
      $(FORM).find('[name=responsible]').val([]).trigger('change');
    });
});

Template.riskEditTask.onDestroyed(function () {
  $(MODAL).off('.riskEditTask');
});

Template.riskEditTask.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getStatuses: function () {
    return ['','backlog','planned','in_progress','in_review','completed']
  },
  getCountermeasure: function () {
    let riskId = Session.get('editRiskDetails');
    return _.clone(this.countermeasures || []).filter(item=>{
      return !item.riskId || item.riskId === riskId;
    })
  },
  getUsers: function () {
    return Session.get('getUsers');
  },
  isSelected: function (value) {
    let item = Session.get('editTask');
    return item && item.countermeasure === value ? 'selected' : '';
  }
});

