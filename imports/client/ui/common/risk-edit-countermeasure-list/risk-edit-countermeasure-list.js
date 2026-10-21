import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';

const FROM_UPPER = 'from-upper'

function getData() {
  const projectId = Router.current().params.query && Router.current().params.query.projectId;
  const moduleId = Router.current().params.query && Router.current().params.query.moduleId;
  Meteor.callAsync('RiskProperties.Find', {moduleId, projectId}).then(function(data) {
    Session.set('getRiskSettingsList', _.sortBy((data ? data : []), 'created').reverse());
  }).catch(function(error) {
    console.error('RiskProperties.Find failed:', error);
  });
}

Template.riskEditCountermeasureList.onRendered(function () {
  $('#riskEditCountermeasureForm').validate({
    rules: {
      countermeasure: {
        required: false
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
      const countermeasure = $(form).find('[name=countermeasure]').val();
      const status = $(form).find('[name=status]').val();
      const comment = $(form).find('[name=comment]').val();
      const responsible = $(form).find('[name=responsible]').val();
      if(!countermeasure){
        Notify.warn('Countermeasure is required');
      }else {
        const _id = Session.get('editRiskDetails')
        const allData = Session.get('getRiskSettingsList')
        const current = _.find(allData, function (elem) {
          return elem._id === _id;
        })
        const self = {
          data: current.riskProperties.countermeasures
        }
        const item = {
          countermeasure,
          status,
          comment,
          responsible
        }
        if(!self.data){
          self.data = [];
        }
        self.data.push(item)
        Meteor.callAsync(
          'RiskProperties.Update',
          {$set:{'riskProperties.countermeasures': self.data}},
          Session.get('editRiskDetails'),
          null
        ).then(data => {
          if(data){
            Notify.success('Countermeasure added');
            getData()
          }
        });
        $(form).find('[name=countermeasure]').val('').trigger('change');
        $(form).find('[name=status]').val('').trigger('change');
        $(form).find('[name=comment]').val('').trigger('change');
        $(form).find('[name=responsible]').val([]).trigger('change');
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
});

Template.riskEditCountermeasureList.helpers({
  reactiveTableSettings: function () {
    const users = Session.get('getUsers');
    const data = Template.currentData();
    let list = (data && data.data)|| [];
    list = list.map((item) => {
      item.responsibleText = item.responsible && item.responsible.length ? item.responsible.map((v) => {
        const item = users && users.find(function (user) {return user.value === v})
        return item && item.label;
      }).join('; ') : '';
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
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableCountermeasureActions,
          cellClass: 'col-actions'
        }
      ]
    };
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
      projectId: Router.current().params.projectId || Router.current().params.query.projectId
    };
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getIndex: function (index) {
    return index + 1
  },
  getUsers: function () {
    return Session.get('getUsers');
  },
  getUserName: function (_id) {
    const list = Session.get('getUsers')
    const item = list && list.find(function (user) {return user.value === _id})
    return item && item.label;
  }
});

Template.riskEditCountermeasureList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this.countermeasure) {
      Session.set('editCountermeasure', this);
      $('#RiskEditCountermeasureModal').modal('show');
    }
  }
});

Template.reactiveTableCountermeasureActions.events({
  'click .remove-item': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    const data = Template.parentData(5);
    const allData = data.data;
    if (allData instanceof Array) {
      const dataWithout = _.reject(allData, function (elem) {
        // _id match for migrated rows; text match keeps legacy id-less rows removable
        return self._id ? elem._id === self._id : elem.countermeasure === self.countermeasure;
      }) || [];
      Meteor.callAsync(
        'RiskProperties.Update',
        {$set:{'riskProperties.countermeasures': dataWithout}},
        Session.get('editRiskDetails'),
        null
      ).then(data => {
        if(data){
          Notify.success('Countermeasure removed');
          getData()
        }
      });
    }
  }
});
