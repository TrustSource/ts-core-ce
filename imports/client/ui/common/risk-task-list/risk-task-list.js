import {Meteor} from 'meteor/meteor'
import {Template} from 'meteor/templating';
import {moment} from 'meteor/momentjs:moment';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import _ from 'underscore';

const CURRENT_PAGE_VAR = 'tasks-current';

Template.riskTaskList.onCreated(function () {
  let currentPage = new ReactiveVar(Session.get(CURRENT_PAGE_VAR) || 0);
  this.currentPage = currentPage;
  this.autorun(function () {
    Session.set(CURRENT_PAGE_VAR, currentPage.get());
  });
});

Template.riskTaskList.onRendered(function () {
  this.autorun(function () {
    Meteor.setTimeout(function () {
      $('select.select2').select2({
        allowClear: true,
        width: '100%'
      });
    },1)
  });
});

Template.riskTaskList.helpers({
  reactiveTableSettings: function () {
    let filteredStates = _.map(Session.get('risksTasksListFilter') || {}, function (value, key) {
      return value === true ? key : undefined;
    });
    const openedTaskStatuses = ['planned','in_progress','in_review']
    const data = Session.get('riskTaskList') || [];
    let list = data.filter(function (item) {
      return !((filteredStates.indexOf('completed') > -1 && item.status && item.status === 'completed') ||
        (filteredStates.indexOf('opened') > -1 && item.status && openedTaskStatuses.indexOf(item.status) > -1) ||
        (filteredStates.indexOf('backlog') > -1 && (!item.status
          || (item.status && item.status === 'backlog'))));

    })
    const viewType = Session.get('tasksViewType')
    if (viewType && viewType !== '') {
      list = _.filter(list, function (item) {
        return (viewType === 'My' && item.responsible.indexOf(Meteor.userId()) > -1) ||
          (viewType === 'Unassigned' && (!item.responsible || (item.responsible && item.responsible.length === 0)))
      });
    }
    const users = Session.get('getUsers');
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
      currentPage: Template.instance().currentPage,
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
          tmpl: Template.reactiveTableTasksListActions,
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

Template.riskTaskList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Session.set('editTask', this);
      Session.set('editRiskDetails', this.riskId);
      $('#RiskEditTaskModal').modal('show');
    }
  }
});

Template.reactiveTableTasksListActions.events({
  'click .remove-item': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    const taskList = Session.get('riskTaskList');
    const listWithout = taskList.filter(function (item) {
      return item._id !== self._id
    })
    Meteor.callAsync('Tasks.Remove', self._id).then(data => {
      if(data){
        Notify.success('Task removed');
        Session.set('riskTaskList', listWithout);
      }
    });
  }
});

