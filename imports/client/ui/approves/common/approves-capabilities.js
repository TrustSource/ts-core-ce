import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import _ from 'underscore';
import {ReactiveVar} from 'meteor/reactive-var';
import ApprovalReports from '/imports/lib/collections/approvalReports';

function getModuleIds(approval) {
  return _.map(approval.modules,function (module) {
    return module._id
  });
}

const CURRENT_PAGE_VAR = 'capabilities-current';

Template.approvesCapabilities.onCreated(function () {
  let currentPage = new ReactiveVar(Session.get(CURRENT_PAGE_VAR) || 0);
  this.currentPage = currentPage;
  this.autorun(function () {
    Session.set(CURRENT_PAGE_VAR, currentPage.get());
  });
});

Template.approvesCapabilities.helpers({
  getCapabilities: function () {
    const approve = this;
    Session.set('requestInProgress', true);
    Session.set('reportCapabilities');
    let getList = ApprovalReports.findOne({type:'capabilities',approveId:approve._id});
    Session.set('reportCapabilities', getList && getList.data);
    Session.set('requestInProgress', false);
    if(getList){
      return getList.data.list
    }else{
      let {projectId, companyId, modules} = approve
      const moduleIds = getModuleIds(approve)
      let getList = ReactiveMethod.call('getProjectCapabilities', projectId, companyId, moduleIds, modules);
      Session.set('reportCapabilities', getList);
      Session.set('requestInProgress', false);
      if(getList){
        return getList.list
      }else{
        return []
      }
    }
  },
  reactiveTableSettings: function () {
    let list = Session.get('reportCapabilities')
    return {
      collection: (list && list.list) || list,
      rowsPerPage: 15,
      currentPage: Template.instance().currentPage,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          sortOrder: 0,
          sortDirection: 'ascending',
          fn: function (value, object) {
            return object.name || '_id: ' + object._id;
          }
        },
        {
          fieldId: 'description',
          key: 'description',
          label: 'Description'
        },
        {
          fieldId: 'version',
          key: 'version',
          label: 'Introduced at version'
        }
      ]
    };
  }
});
