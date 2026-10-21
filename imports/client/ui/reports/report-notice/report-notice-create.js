import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';


Template.reportNoticeFileCreate.onRendered(function () {
  $('#createNoticeFileForm').validate({
    rules: {
      noticeFileProjectModule: {
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
      const noticeFileKey = $(form).find('[name=noticeFileProjectModule]').val();
      if(user) {
        Session.set('noticeCreateLoading', true);
        Meteor.callAsync('NoticeFiles.Create', {
          projectId: noticeFileKey.split('_m_')[0],
          moduleId: noticeFileKey.split('_m_')[1] || null
        }).then(function() {
          Meteor.callAsync('logEvent', user, 'New notice file has been created', 'noticeFileCreated');
          Notify.success('New notice file has been created');
          Meteor.setTimeout(function () {
            Session.set('noticeCreateLoading');
            $('#createNoticeFile').modal('hide');
          }, 300);
        }).catch(function(error) {
          Session.set('noticeCreateLoading');
          let textError = 'Error: ' + (error.reason || ' could not create notice file');
          Meteor.callAsync('logEvent', user, textError, 'noticeFileCreated');
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

  $('#createNoticeFile').off('.reportNoticeFileCreate')
    .on('show.bs.modal.reportNoticeFileCreate', function (event) {
      $('#createNoticeFileForm')[0].reset();
      $(event.target).find('[name=noticeFileProjectModule]').val('').removeClass('error');
      Session.set('createNoticeFileMsg');
      Meteor.setTimeout(function () {
        $('.select2').select2({width: '100%'});
        $('#noticeFileProjectModule').val('').trigger('change');
      },1)
    })
    .on('hidden.bs.modal.reportNoticeFileCreate', function () {
      Session.set('createNoticeFileMsg');
      Session.set('noticeCreateLoading');
    });
});

Template.reportNoticeFileCreate.onDestroyed(function () {
  $('#createNoticeFile').off('.reportNoticeFileCreate');
});

Template.reportNoticeFileCreate.events({
  'submit #createNoticeFileForm': function (event) {
    event.preventDefault();
  }
});

Template.reportNoticeFileCreate.helpers({

  createNoticeFileMsgType: function () {
    let msg = Session.get('createNoticeFileMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createNoticeFileMsg: function () {
    return Session.get('createNoticeFileMsg');
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  loading: function () {
    return Session.get('noticeCreateLoading');
  },

  projectList: function () {
    return Session.get('companyProjects');
  }
});
