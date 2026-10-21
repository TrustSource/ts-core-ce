import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Projects from '/imports/lib/collections/projects';
import reportObligationsService from '/imports/lib/reports/reportObligationsService';

function initResolveByNoticeForm() {
  const form = $('#resolveByNoticeForm');
  if (form.length) {
    form.validate({
      submitHandler: function () {
        const user = Meteor.user();
        if(user) {
          Meteor.callAsync('NoticeFiles.Create', {
            projectId: Projects.UNASSIGNED === Router.current().params.projectId ? undefined : Router.current().params.projectId,
            moduleId: Router.current().params.moduleId,
            analysisId: Router.current().params.query.analysis
          }).then(function(data) {
            Meteor.setTimeout(function () {
              $('#resolveByNotice').modal('hide');
              $('.modal-backdrop.fade').remove();
              $('body').removeClass('modal-open').css({'padding-right': 0});
            }, 10);
            Meteor.setTimeout(()=>{
              Session.set('newCreatedNoticeFileId',data);
            },100)
            Meteor.callAsync('logEvent', user, 'New notice file has been created', 'noticeFileCreated');
            Notify.success('New notice file has been created');
          }).catch(function(error) {
            Meteor.setTimeout(function () {
              $('#resolveByNotice').modal('hide');
              $('.modal-backdrop.fade').remove();
              $('body').removeClass('modal-open').css({'padding-right': 0});
            }, 10);
            let textError = 'Error: ' + (error.reason || ' could not create notice file');
            Meteor.callAsync('logEvent', user, textError, 'noticeFileCreated');
            Notify.danger(textError);
          });
        }
      }
    });
  }
}

Template.moduleResolveByNotice.onRendered(function () {
  Session.set('newCreatedNoticeFileId',false);
  initResolveByNoticeForm();
});

$(document).on('shown.bs.modal', '#resolveByNotice', function () {
  initResolveByNoticeForm();
});

Template.moduleResolveByNotice.helpers({
  hasProjectObligations: function () {
    const user = Meteor.user();
    const projectId = Router.current().params.projectId || (Router.current().params.query && Router.current().params.query.projectId);
    Session.set('requestInProgress', true);
    const moduleId = Router.current().params.moduleId || (Router.current().params.query && Router.current().params.query.moduleId);
    const moduleIds = moduleId ? [moduleId]: false;
    const analysisId = Router.current().params.query.analysis || (this.analysis && this.analysis[0] && this.analysis[0]._id)
    const modulesConfig = [{
      _id: moduleId,
      analysisId
    }]
    let getList = ReactiveMethod.call('getProjectObligations', projectId, user.profile.companyId, moduleIds, modulesConfig);
    if(getList){
      const autoResolvable = ['O11','O22','O01']
      getList.autoResolved = _.filter(getList.list, (obligation) => {
        return autoResolvable.indexOf(obligation.key) > -1
      })
      const resolvable = ['O10','O21','O23','O41','O42','O60']
      getList.resolved = _.filter(getList.list, (obligation) => {
        return resolvable.indexOf(obligation.key) > -1
      })
      getList.other = _.filter(getList.list, (obligation) => {
        return resolvable.indexOf(obligation.key) === -1 && autoResolvable.indexOf(obligation.key) === -1
      })
    }
    Session.set('reportProjectObligations', getList);
    if(getList){
      Session.set('requestInProgress', false);
      return getList.list
    }else{
      return []
    }
  },
  getProjectObligations:function () {
    let getList = Session.get('reportProjectObligations');
    return getList.list;
  },
  getAutoResolved:function () {
    let getList = Session.get('reportProjectObligations');
    return getList.autoResolved;
  },
  getResolved:function () {
    let getList = Session.get('reportProjectObligations');
    return getList.resolved;
  },
  nothingToResolve:function () {
    let getList = Session.get('reportProjectObligations');
    return getList && !getList.resolved.length && !getList.autoResolved.length;
  },
  hasOtherToResolve:function () {
    let getList = Session.get('reportProjectObligations');
    return getList.other;
  },
  getObligationDescription: function (obligationKey) {
    return reportObligationsService.getObligationDescription(obligationKey)
  },
  getObligationStatus: function (obligationKey) {
    return reportObligationsService.getObligationStatus(obligationKey)
  },
  getObligationSuggestion: function (obligationKey) {
    return reportObligationsService.getObligationSuggestion(obligationKey)
  },
  isNoticeAvailable: function () {
    const analysisId = Router.current().params.query.analysis || (this.analysis && this.analysis[0] && this.analysis[0]._id)
    const newFile = Session.get('newCreatedNoticeFileId');
    if(newFile){
      return {_id: newFile}
    }
    return analysisId ? ReactiveMethod.call('NoticeFiles.FindByAnalysis', analysisId) : false;
  },
  getNoticeOptions: function () {
    return this._id ? {noticeId: this._id} : {}
  },
  getSize: function () {
    let data = Template.parentData();
    return data && data.size
  },
  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  }
});
