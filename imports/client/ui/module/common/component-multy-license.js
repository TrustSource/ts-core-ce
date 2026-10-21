import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';
import Company from '/imports/lib/company/Company';
import {buildLicensesSelected} from '/imports/client/ui/module/common/multyLicenseSelect';
import {pathLocation, pathLicenses} from '/imports/lib/analysis/pathLocation';

function isLicenseSelected(module, component, version, path, selectedLicense) {
  const key = (component && component.getKey && component.getKey()) || (component && component.key);
  return module && module.isLicenseSelected &&
    module.isLicenseSelected(key, version, pathLocation(path), selectedLicense);
}

// The template renders once per dependency path inside {{#each}}, but only the
// clicked instance ever opens its modal (modalVisible is instance-scoped). The
// click handler captures the clicked component AND the clicked instance's
// visibility var at module scope so the module-level shown/hidden handlers (the
// modal is reparented to <body> by the global show.bs.modal, so Blaze/instance
// handlers can't reach it) can clear that exact instance on close.
let _multyLicenseComponent = null;
let _activeModalVisible = null;

Template.componentMultyLicense.onCreated(function () {
  this.modalVisible = new ReactiveVar(false);
});

Template.componentMultyLicense.events({
  'click .showComponentMultyLicense': function (event, instance) {
    event.preventDefault();
    // Save component reference before modal opens
    try {
      _multyLicenseComponent = Template.parentData(3);
    } catch (e) {
      console.log('componentMultyLicense: unable to get parent data', e.message);
      _multyLicenseComponent = null;
    }
    _activeModalVisible = instance.modalVisible;
    instance.modalVisible.set(true);
    Meteor.setTimeout(function () {
      $('#componentMultyLicense').modal('show');
    },1)
  }
});

Template.componentMultyLicense.helpers({
  modalVisible: function () {
    return Template.instance().modalVisible.get();
  },

  licenseStatus: function () {
    const company = Session.get('company')
    const companyClass = new Company(company);
    const project = Projects.findOne({_id: Router.current().params.projectId});
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const path = Template.parentData().path;
    const version = Template.parentData().version;
    const license = this.data();
    if (!!license && !!version && !!path && !!path.component) {
      let pathLicense = _.clone(_.find(pathLicenses(path.path), function (licenseItem) {
        return licenseItem.key === license.key
      }));
      if (pathLicense && pathLicense.status) {
        pathLicense.status.computedStatus = Utils.computedLicenseStatusDetails(module, project,
          companyClass, license.key, pathLicense.status);
        return pathLicense.status
      }
    }
  },

  isPrivateLicense: function (computedStatus) {
    return computedStatus && computedStatus.privateLicense
  },

  componentMultyLicenseMsgType: function () {
    let msg = Session.get('componentMultyLicenseMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  componentMultyLicenseMsg: function () {
    return Session.get('componentMultyLicenseMsg');
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  describeObligations: function (obligations) {
    return _.map(obligations.split('; '),function (obligation) {
      return Utils.translateObligations(obligation)
    });
  },

  describeViolations: function (violations) {
    return _.map(violations.split('; '),function (violation) {
      return Utils.translatePermitions(violation)
    });
  },

  isSelected: function () {
    const module = Modules.findOne({_id: Router.current().params.moduleId});
    const component = Template.parentData(3);
    // const path = Template.parentData(1).path.path;
    // const version = this.version.getVersion();
    return isLicenseSelected(module, component, null, null, this.getKey()) ? 'checked' : false;
  },

  getType: function () {
    let status = this.type;
    return status ? {
      key:status+'s',
      text:status[0].toUpperCase()+status.substr(1,status.length)
    }: null
  }
});

// The modal is reparented to <body> by the global show.bs.modal body-move, so
// its events are bound via $(document) delegation rather than Template events.
$(document).on('show.bs.modal', '#componentMultyLicense', function () {
  Session.set('componentMultyLicenseMsg');
});

// Wire up jquery-validation submitHandler when modal is shown
$(document).on('shown.bs.modal', '#componentMultyLicense', function () {
  $('#componentMultyLicenseForm').validate({
    submitHandler: function (form) {
      const selectedLicense = $(form).find('[name=selectedLicense]:checked').val();
      if (!selectedLicense) return;

      const user = Meteor.user();
      const now = new Date();
      const module = Modules.findOne({_id: Router.current().params.moduleId});
      const component = _multyLicenseComponent;
      if (!component) {
        Notify.danger('Could not determine component. Please close and try again.');
        return;
      }
      const arr = module.getLicenseSelected();
      const originalData = _.clone(arr);
      const comment = 'added from modal form. By ' + ((user.profile && user.profile.name)
        || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
        + ', ' + now.toLocaleDateString();
      const nextArr = buildLicensesSelected(arr, component.getKey(), selectedLicense, comment);
      Meteor.callAsync('updateCollection', 'Modules', module._id, 'componentConfig.licensesSelected', nextArr, true, originalData)
        .then(function () {
          Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
        })
        .catch(function (error) {
          console.error('License selection save error:', error);
          Notify.danger('Failed to save license selection: ' + (error.reason || error.message));
        });
      Notify.successHtml('License successfully selected! <br>' +
        'NOTE: Licenses selected manually will not appear in the component or legal views until you have executed ' +
        'a new analysis run!  The views actually are representations of an analysis result.');
      Meteor.setTimeout(function () {
        $('#componentMultyLicense').modal('hide');
      }, 300);
    }
  });
});

// Clean teardown on close by ANY path (Close button, Update success, backdrop).
// Clears the clicked instance's visibility var so Blaze re-renders without the
// modal block, then explicitly detaches the node: the global show.bs.modal
// body-move reparented it to <body>, outside Blaze's DOM range, so Blaze can no
// longer remove it on its own - leaving an orphaned #componentMultyLicense node
// attached to <body>. Finally strip any leftover backdrop / modal-open class.
$(document).on('hidden.bs.modal', '#componentMultyLicense', function () {
  Session.set('componentMultyLicenseMsg');
  if (_activeModalVisible) {
    _activeModalVisible.set(false);
    _activeModalVisible = null;
  }
  $(this).remove();
  $('body').removeClass('modal-open');
  $('.modal-backdrop').remove();
});
