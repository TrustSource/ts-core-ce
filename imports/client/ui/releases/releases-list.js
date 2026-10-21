import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {moment} from 'meteor/momentjs:moment';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import Projects from '/imports/lib/collections/projects';
import Module from '/imports/lib/project/Module';
import Utils from '/imports/lib/utils';

Template.releasesList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.releasesList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  let timerId = Meteor.setInterval(function () {
    if(Session.get('modulesByProject')) {
      let result = Projects.findMapped();
      Session.set('companyProjects', result);
      Meteor.clearInterval(timerId);
      Meteor.setTimeout(function () {
        $('.select2').select2({width: '100%'});
      },1)
    }
  }, 100)
  const projectId = Router.current().params.query && Router.current().params.query.projectId;
  const moduleId = Router.current().params.query && Router.current().params.query.moduleId;
  if(projectId) {
    let newUrl = Router.current().route.path() + '?projectId=' + projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId=' + moduleId;
    }
    Router.go(newUrl);
  }
});
Template.releasesList.events = {
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button, .modal').length) return;
    if (this._id) {
      Router.go('releasesDetailsOverview', {approveId: this._id});
    }
  },
  'change .current-project': function (event) {
    let currentCode = $(event.target).val();
    let moduleId = currentCode.split('_m_')[1];
    let projectId = currentCode.split('_m_')[0];
    let newUrl = Router.current().route.path()+'?projectId='+projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId='+moduleId;
    }
    Router.go(newUrl);
  }
};

Template.releasesList.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  projectList: function () {
    return Session.get('companyProjects');
  },
  isActiveProject:function () {
    return !Router.current().params.query.moduleId && Router.current().params.query.projectId === this._id
  },
  isActiveModule:function () {
    return Router.current().params.query.moduleId === this._id
  },

  reactiveTableSettings: function () {
    let fields = [
      {
        fieldId: 'approved',
        key: 'approved',
        label: 'Approved',
        tmpl: Template.reactiveTableDateCell,
        cellClass: 'col-date',
        sortable: true,
        sortOrder: 0,
        sortDirection: 'descending'
      },
      {
        fieldId: 'name',
        key: 'name',
        label: 'Name'
      },
      {
        fieldId: 'version',
        key: 'version',
        label: 'Version'
      },
      {
        fieldId: 'projectId',
        key: 'projectId',
        label: 'Project/Module',
        tmpl: Template.reactiveTableApprovesListProject,
        sortable: true,
        sortFn: function (value, object) {
          if(object.moduleId){
            return (object.projectObj && object.projectObj.name || '')+'/'+(object.moduleObj && object.moduleObj.name || '');
          }else if(object.projectId){
            return object.projectObj.name
          }else {
            return ' '
          }
        }
      },
      {
        fieldId: 'closedByName',
        key: 'closedByName',
        label: 'Contact'
      },
      {
        fieldId: 'link',
        key: 'link',
        label: '',
        cellClass: 'col-actions',
        tmpl: Template.reactiveTableReleasesLinkRelease
      }
    ];
    return {
      collection: JSON.stringify(this) === JSON.stringify({}) ? [] : this,
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: fields
    };
  }
});

function moduleCreateCallback(error) {
  const user = Meteor.user();
  if (error) {
    const message = 'Error: ' + (error.reason || ' could not create module');
    Meteor.callAsync('logEvent', user, message, 'moduleCreated');
    Session.set('createModuleMsg', message);
  } else {
    Meteor.callAsync('logEvent', user, 'New module created', 'moduleCreated');
    Session.set('createModuleMsg', 'Module successfully created!');
  }
}

let _releaseLinkData = null;

function releaseLinkSubmit(form) {
  const selectedProject = $(form).find('[name=selectedProject]').val();
  if (!selectedProject) {
    Notify.warn('Select project before link module');
    return;
  }
  const self = _releaseLinkData;
  if (!self) {
    Notify.danger('Could not determine release. Please close and try again.');
    return;
  }
  const user = Meteor.user();
  let moduleName = self.name;
  let projectId = selectedProject;
  let moduleVersion = self.version;
  let module = new Module(user.profile.companyId, moduleName, Utils.generateModuleIdentifier(moduleName));
  module.version = moduleVersion;
  module.projectId = projectId;
  module.properties = {
    privacy: 'private',
    architecture: 'linkedProject'
  }
  module.linkedProject = {
    projectId,
    projectName: moduleName,
    approveId: self._id,
    approveName: self.name,
    approveVersion: moduleVersion,
    approveModules: self.modules
  };
  Meteor.callAsync('setModuleRelatedUsers', user._id, module).then(function (result) {
    module = result;
    Meteor.callAsync('createLinkedModule', module).then(function () {
      moduleCreateCallback();
    }).catch(function (err) {
      moduleCreateCallback(err);
    });
    Meteor.setTimeout(function () {
      $('#releaseLink').modal('hide');
      $('body').removeClass('modal-open');
      $('.modal-backdrop').remove();
      Session.set('modalVisible');
    }, 300);
  }).catch(function (error) {
    const message = 'Internal Error: ' + (error.reason || 'Module: ' + module.name + ' not created');
    Notify.danger(message);
    Meteor.callAsync('logEvent', user, message, 'moduleCreated');
  });
}

Template.reactiveTableReleasesLinkRelease.events({
  'click .showReleaseLink': function (event) {
    event.preventDefault();
    _releaseLinkData = this;
    Session.set('modalVisible', this._id);
    Meteor.setTimeout(function () {
      const modal = $('#releaseLink');
      modal.modal('show');
      modal.off('shown.bs.modal.releaseLinkInit').on('shown.bs.modal.releaseLinkInit', function () {
        const form = $('#releaseLinkForm');
        if (form.length) {
          form.validate({
            submitHandler: releaseLinkSubmit
          });
          modal.find('select[name=selectedProject]').select2({width: '100%'});
        }
      });
    }, 1);
  }
});

$(document).on('hidden.bs.modal', '#releaseLink', function () {
  Session.set('modalVisible');
});

Template.reactiveTableReleasesLinkRelease.helpers({
  modalVisible: function () {
    return Session.get('modalVisible') === this._id
  },
  projectList: function () {
    return Session.get('companyProjects');
  },
  getApproveOptions: function () {
    return {approveId: this._id};
  }
});

function getDateCellValue(row, field) {
  if (!row || !field) return null;
  if (field.fn) return field.fn(row[field.key], row, field.key);
  let key = field.key;
  let keys = key.split('.');
  let value = row;
  for (let i = 0; i < keys.length; i++) {
    if (value == null) return null;
    value = value[keys[i]];
  }
  return value;
}

Template.reactiveTableDateCell.helpers({
  title: function () {
    const date = getDateCellValue(this, Template.parentData(1));
    return date ?  moment(date).format('lll') : ''
  },
  sort: function () {
    const date = getDateCellValue(this, Template.parentData(1));
    return date ?  moment(date).unix() : ''
  },
  text: function () {
    const date = getDateCellValue(this, Template.parentData(1));
    return date ?  moment(date).format('ll') : ''
  }
});
