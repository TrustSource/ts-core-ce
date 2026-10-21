import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import _ from 'underscore';
import ApprovalReports from '/imports/lib/collections/approvalReports';

function getModuleIds(approval) {
  return _.map(approval.modules,function (module) {
    return module._id
  });
}

Template.approvesExportControl.helpers({
  getExportControl: function () {
    const approve = this;
    Session.set('requestInProgress', true);
    Session.set('reportExportControl');
    let getList = ApprovalReports.findOne({type:'export_control',approveId:approve._id});
    Session.set('reportExportControl', getList && getList.data);
    Session.set('requestInProgress', false);
    if(getList){
      return getList.data.list
    }else{
      let {projectId, companyId, modules} = approve
      const moduleIds = getModuleIds(approve)
      let getList = ReactiveMethod.call('getProjectExportControl', projectId, companyId, moduleIds, modules);
      Session.set('reportExportControl', getList);
      Session.set('requestInProgress', false);
      if(getList){
        return getList.list
      }else{
        return []
      }
    }
  },
  isDenied: function () {
    const company = Session.get('company');
    let self = this
    if(company && company.blacklistedAlgorithms && company.blacklistedAlgorithms.length){
      return company.blacklistedAlgorithms.some(algorithm => {
        if(!algorithm.key || !self.algorithm){
          return false;
        }
        return algorithm.key.toLowerCase() === self.algorithm.toLowerCase();
      })
    }else{
      return false
    }
  },
  reportExportControlAlgorithms: function () {
    let report = Session.get('reportExportControl');
    return report && report.algorithms
  }
});
