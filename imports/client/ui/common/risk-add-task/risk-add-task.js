 
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';

const FORM = '#RiskAddTaskForm'
const MODAL = '#RiskAddTaskModal'

function getData() {
  Meteor.callAsync('Tasks.Find', {riskId: Session.get('editRiskDetails')}).then(function(result) {
    Session.set('riskEditTaskList', result);
  }).catch(function(error) {
    console.error('Tasks.Find failed:', error);
  })
}

Template.riskAddTask.onRendered(function () {
  Session.set('WithNext');
  $('#RiskAddTaskForm').validate({
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
        Meteor.callAsync('Tasks.Create', item, null).then(() => {
          Notify.success('Task added');
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
          const message = 'Error: ' + (error.reason || 'Countermeasure: ' + countermeasure + ' not created');
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

  // Modals are moved to <body> on show (global handler), which detaches them
  // from the Blaze template DOM range - Template.events never fires inside.
  // Bind delegated handlers on the modal element itself: they travel with it.
  $(MODAL).off('.riskAddTask')
    .on('submit.riskAddTask', FORM, function (event) {
      event.preventDefault();
    })
    .on('click.riskAddTask', '.without_next', function () {
      Session.set('WithNext');
    })
    .on('click.riskAddTask', '.with_next', function () {
      Session.set('WithNext', true);
    })
    .on('show.bs.modal.riskAddTask', function () {
      Meteor.setTimeout(function () {
        $(MODAL + ' select.select2').select2({
          allowClear: true,
          width: '100%'
        });
      }, 100);
    })
    .on('hide.bs.modal.riskAddTask', function () {
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

Template.riskAddTask.onDestroyed(function () {
  $(MODAL).off('.riskAddTask');
});

Template.riskAddTask.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getStatuses: function () {
    return ['','backlog','planned','in_progress','in_review','completed']
  },
  getCountermeasure: function () {
    let list = _.clone(this.countermeasures || []);
    list.unshift({countermeasure: ''})
    return list
  },
  getUsers: function () {
    return Session.get('getUsers');
  }
});

