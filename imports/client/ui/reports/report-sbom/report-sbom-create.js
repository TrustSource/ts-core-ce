import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';


Template.reportSbomFileCreate.onRendered(function () {
  $('#createSbomFileForm').validate({
    rules: {
      sbomFileProjectModule: {
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
      const user = Meteor.user();
      const sbomFileKey = $(form).find('[name=sbomFileProjectModule]').val();
      if(user) {
        Session.set('sbomCreateLoading', true);
        Meteor.callAsync('SbomFiles.Create', {
          projectId: sbomFileKey.split('_m_')[0],
          moduleId: sbomFileKey.split('_m_')[1] || null
        }).then(function() {
          Meteor.callAsync('logEvent', user, 'New SBOM file has been created', 'sbomFileCreated');
          Notify.success('New SBOM file has been created');
          Meteor.setTimeout(function () {
            Session.set('sbomCreateLoading');
            $('#createSbomFile').modal('hide');
          }, 300);
        }).catch(function(error) {
          Session.set('sbomCreateLoading');
          let textError = 'Error: ' + (error.reason || ' could not create SBOM file');
          Meteor.callAsync('logEvent', user, textError, 'sbomFileCreated');
          Notify.danger(textError);
        });
      }
    }
  });
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

  $('#createSbomFile').off('.reportSbomFileCreate')
    .on('show.bs.modal.reportSbomFileCreate', function (event) {
      $('#createSbomFileForm')[0].reset();
      $(event.target).find('[name=sbomFileProjectModule]').val('').removeClass('error');
      Session.set('createSbomFileMsg');
      Meteor.setTimeout(function () {
        $('.select2').select2({width: '100%'});
        $('#sbomFileProjectModule').val('').trigger('change');
      },1)
    })
    .on('hidden.bs.modal.reportSbomFileCreate', function () {
      Session.set('createSbomFileMsg');
      Session.set('sbomCreateLoading');
    });
});

Template.reportSbomFileCreate.onDestroyed(function () {
  $('#createSbomFile').off('.reportSbomFileCreate');
});

Template.reportSbomFileCreate.events({
  'submit #createSbomFileForm': function (event) {
    event.preventDefault();
  }
});

Template.reportSbomFileCreate.helpers({

  createSbomFileMsgType: function () {
    let msg = Session.get('createSbomFileMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createSbomFileMsg: function () {
    return Session.get('createSbomFileMsg');
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  loading: function () {
    return Session.get('sbomCreateLoading');
  },

  projectList: function () {
    return Session.get('companyProjects');
  }
});
