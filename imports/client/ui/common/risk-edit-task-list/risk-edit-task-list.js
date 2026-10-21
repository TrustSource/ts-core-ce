import {Meteor} from 'meteor/meteor'
import {Template} from 'meteor/templating';
import {moment} from 'meteor/momentjs:moment';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

const TASK_FIND = 'Tasks.Find'

Template.riskEditTaskList.onRendered(function () {
  this.autorun(function () {
    Meteor.setTimeout(function () {
      $('select.select2').select2({
        allowClear: true,
        width: '100%'
      });
      Meteor.callAsync(TASK_FIND, {riskId: Session.get('editRiskDetails')}).then(function(result) {
        Session.set('riskEditTaskList', result);
      }).catch(function(error) {
        console.error('Tasks.Find failed:', error);
      })
    },1)
  });
});

Template.riskEditTaskList.helpers({
  reactiveTableSettings: function () {
    const users = Session.get('getUsers');
    let list = Session.get('riskEditTaskList') || [];
    list = list.map((item) => {
      item.responsibleText = item.responsible && item.responsible.length ? item.responsible.map((v) => {
        const item = users && users.find(function (user) {return user.value === v})
        return item && item.label;
      }).join('; ') : '';
      item.dueFormated = item.due ? moment(item.due).format('ll') : '';
      return item;
    })
    return {
      collection: list,
      rowsPerPage: 15,
      showFilter: true,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'countermeasure',
          key: 'countermeasure',
          label: 'Countermeasure'
        },
        {
          fieldId: 'task',
          key: 'task',
          label: 'Tasks'
        },
        {
          fieldId: 'dueFormated',
          key: 'dueFormated',
          label: 'Due date'
        },
        {
          fieldId: 'frequency',
          key: 'frequency',
          label: 'Frequency'
        },
        {
          fieldId: 'status',
          key: 'status',
          label: 'Status'
        },
        {
          fieldId: 'comment',
          key: 'comment',
          label: 'Comment'
        },
        {
          fieldId: 'responsibleText',
          key: 'responsibleText',
          label: 'Responsible',
          cellClass: 'col-sender'
        },
        {
          fieldId: 'externalTasks',
          key: 'externalTasks',
          label: ' ',
          sortable: false,
          tmpl: Template.reactiveTableExternalTasksActions,
          cellClass: 'col-actions text-right'
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableTasksActions,
          cellClass: 'col-actions'
        }
      ]
    };
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

Template.riskEditTaskList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Session.set('editTask', this);
      $('#RiskEditTaskModal').modal('show');
    }
  }
});

Template.reactiveTableTasksActions.events({
  'click .remove-item': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    Meteor.callAsync('Tasks.Remove', self._id).then(data => {
      if(data){
        Notify.success('Task removed');
        Meteor.callAsync(TASK_FIND, {riskId: Session.get('editRiskDetails')}).then(function(result) {
          Session.set('riskEditTaskList', result);
        })
      }
    });
  }
});

Template.reactiveTableExternalTasksActions.helpers({
  getProblemDescription: function () {
    const self = this;
    return {
      text: 'Task "'+ self.task +'" is "' + (self.status ? self.status : 'created') + '" \n'+ `${self.comment ? self.comment : ''}`,
      title: self.task + ' (Risk related task)'
    }
  },
  projectId: function () {
    return Router.current().params.query && Router.current().params.query.projectId
  },
  githubLink: function () {
    const self = this;
    return self.githubLink
  },
  getRepository: function () {
    const projectId = Router.current().params.query && Router.current().params.query.projectId;
    const moduleId = Router.current().params.query && Router.current().params.query.moduleId;
    const projects = Session.get('companyProjects');
    let module;
    const project = projects && projects.find(function (project) {
      if(moduleId){
        module = project.listModules.find(function (module) {
          return module._id === moduleId;
        })
      }
      return project._id === projectId;
    })
    const projectRepo = project && project.repository ? project.repository : null
    const moduleRepo = module && module.urls && module.urls.repository ? module.urls.repository : null
    const company = Session.get('company');
    const companyRepo = company && company.github && company.github.active ? company.github.repository : null
    return moduleRepo || projectRepo || companyRepo
  }
});

