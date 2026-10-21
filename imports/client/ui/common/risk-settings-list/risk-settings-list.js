import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {ReactiveVar} from 'meteor/reactive-var';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import {RESOLVED_RISK_STATES} from '/imports/lib/schemas/riskSchema';

const FROM_UPPER = 'from-upper'

const CURRENT_PAGE_VAR = 'risks-current';

Template.riskSettingsList.onCreated(function () {
  let currentPage = new ReactiveVar(Session.get(CURRENT_PAGE_VAR) || 0);
  this.currentPage = currentPage;
  this.autorun(function () {
    Session.set(CURRENT_PAGE_VAR, currentPage.get());
  });
});

Template.riskSettingsList.onRendered(function () {
  $('.i-checks').iCheck({
    checkboxClass: 'icheckbox_square-green',
    radioClass: 'iradio_square-green'
  });
});

Template.riskSettingsList.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  reactiveTableSettings: function () {
    const data = Template.currentData();
    let filterName = data.filterSessionVar;
    let filteredStates = _.map(Session.get(filterName) || {}, function (value, key) {
      return value === true ? key : undefined;
    });
    const resolvedStates = RESOLVED_RISK_STATES;
    let list = data.data.filter(function (item) {
      return !((filteredStates.indexOf('resolved') > -1 && resolvedStates.indexOf(item.riskProperties.state) > -1) ||
        (filteredStates.indexOf('unidentified') > -1 && !item.riskProperties.state) ||
        (filteredStates.indexOf('opened') > -1 && item.riskProperties.state
          && resolvedStates.indexOf(item.riskProperties.state) === -1));
    }).map(function (item) {
      item.countermeasures = (item.riskProperties && item.riskProperties.countermeasures
        && item.riskProperties.countermeasures.length) || 0;
      return item;
    })
    return {
      collection: list,
      rowsPerPage: 15,
      currentPage: Template.instance().currentPage,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'created',
          key: 'created',
          label: 'Added',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          // Keeps the name readable; the table scrolls sideways instead.
          cellClass: 'col-risk-name',
          fn: function (value, object) {
            return object.name || '_id: ' + object._id;
          }
        },
        {
          fieldId: 'riskProperties.origin',
          key: 'riskProperties.origin',
          label: 'Origin'
        },
        {
          fieldId: 'riskProperties.impactClass',
          key: 'riskProperties.impactClass',
          label: 'Impact class',
          sortFn: function (value) {
            const list = [
              '',
              'low',
              'moderate',
              'high',
              'critical',
              'existential'
            ]
            return list.indexOf(value)
          }
        },
        {
          fieldId: 'riskProperties.confidentiality',
          key: 'riskProperties.confidentiality',
          label: 'C',
          tmpl: Template.reactiveTableRiskCheckActions,
          cellClass: 'col-40',
          fn: function (value) {
            return value
          },
          sortFn: function (value) {
            return value
          }
        },
        {
          fieldId: 'riskProperties.integrity',
          key: 'riskProperties.integrity',
          label: 'I',
          tmpl: Template.reactiveTableRiskCheckActions,
          cellClass: 'col-40',
          fn: function (value) {
            return value
          },
          sortFn: function (value) {
            return value
          }
        },
        {
          fieldId: 'riskProperties.availability',
          key: 'riskProperties.availability',
          label: 'A',
          tmpl: Template.reactiveTableRiskCheckActions,
          cellClass: 'col-40',
          fn: function (value) {
            return value
          },
          sortFn: function (value) {
            return value
          }
        },
        {
          fieldId: 'riskProperties.impactDescription',
          key: 'riskProperties.impactDescription',
          label: 'Impact description'
        },
        {
          fieldId: 'riskProperties.impact',
          key: 'riskProperties.impact',
          label: 'Value',
          fn: function (value) {
            return value ? Number(value).toLocaleString() : ''
          },
          sortFn: function (value) {
            return Number(value)
          }
        },
        {
          fieldId: 'riskProperties.generalApproach',
          key: 'riskProperties.generalApproach',
          label: 'General approach',
          sortFn: function (value) {
            const list = [
              '',
              'ignore',
              'transfer',
              'mitigate',
              'resolve'
            ]
            return list.indexOf(value)
          }
        },
        {
          fieldId: 'countermeasures',
          key: 'countermeasures',
          label: 'Countermeasures'
        },
        {
          fieldId: 'riskProperties.state',
          key: 'riskProperties.state',
          label: 'State',
          sortFn: function (value) {
            const list = [
              '',
              'identified',
              'assessed',
              'approved',
              'planned',
              'implementing',
              'monitored',
              'accepted',
              'closed',
              'deferred',
              'escalated',
              'expired'
            ]
            return list.indexOf(value)
          }
        },
        {
          fieldId: '_id',
          key: '_id',
          label: '_id',
          hidden: true
        },
        {
          fieldId: 'actions',
          key: 'actions',
          sortable: false,
          label: ' ',
          tmpl: Template.reactiveTableRiskSettingsActions
        }
      ]
    };
  },
  editDetails: function () {
    const _id = Session.get('editRiskDetails')
    const allData = Session.get('getRiskSettingsList')
    if (allData instanceof Array) {
      return _.find(allData, function (elem) {
        return elem._id === _id;
      });
    }
  }
});

Template.riskSettingsList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Session.set('editRiskDetails', this._id);
    }
  }
});

Template.reactiveTableRiskSettingsActions.helpers({
  isFromModule: function () {
    return this.moduleItem ? FROM_UPPER : ''
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

  getModuleOptions: function () {
    return {
      projectId: Router.current().params.projectId || Router.current().params.query.projectId,
      moduleId: this.moduleId || Router.current().params.query.moduleId
    };
  },

  isReadonly: function () {
    let settings = Template.parentData(5)
    return settings.readonly
  },

  getRiskDetailsOptions: function () {
    let options = {
      riskId: this._id
    }
    if(this.projectId){
      options.projectId = this.projectId
    }else if(this.moduleId){
      let projects = Session.get('companyProjects') || [];
      let moduleId = this.moduleId;
      let project = projects.find(function (elem) {
        return _.some(elem.listModules,function (item) {
          return item._id === moduleId
        })
      })
      options.projectId = project && project._id
    }
    if(this.moduleId){
      options.moduleId = this.moduleId
    }
    return options;
  }
});

Template.reactiveTableRiskSettingsActions.events({
  'click .remove-risk': function (event) {
    event.preventDefault();
    const self = this;
    const allData = Session.get('getRiskSettingsList')
    if (allData instanceof Array) {
      const dataWithout = _.reject(allData, function (elem) {
        return elem._id === self._id;
      }) || [];
      Meteor.callAsync('RiskProperties.Remove', self._id).then(function() {
        Notify.success('Successfully removed');
      });
      Session.set('getRiskSettingsList', dataWithout);
    }
  }
});

Template.reactiveTableRiskCheckActions.helpers({
  getCheck: function () {
    let settings = Template.parentData()
    let parts = settings.fieldId.split('.');
    // Older risks hold the C/I/A flags as 'true'/'false' strings.
    const value = this.riskProperties && this.riskProperties[parts[1]];
    return value === true || value === 'true'
  }
});
