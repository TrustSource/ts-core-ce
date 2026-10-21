import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Blaze} from 'meteor/blaze';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';


Template.noticeFileDetailsOffer.onRendered(function () {
  $('#reportNoticeOfferForm').validate({
    rules: {
      writtenOfferTitle: {
        required: false
      },
      writtenOfferDescription: {
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
      const title = $(form).find('[name=writtenOfferTitle]').val();
      const description = $(form).find('[name=writtenOfferDescription]').val();
      const data = Blaze.getData($('#reportNoticeOffer')[0]);
      const noticeFile = data.noticeFile;
      try{
        data.updateNoticeFile({
          '$set':{
            'writtenOffer.title': title,
            'writtenOffer.description': description
          }
        },noticeFile, {_id: noticeFile._id});
        Meteor.setTimeout(function () {
          $('#reportNoticeOffer').modal('hide');
        }, 300);
      } catch (error) {
        const user = Meteor.user();
        let textError = 'Error: ' + (error || ' could not update notice file');
        Meteor.callAsync('logEvent', user, textError, 'noticeFileUpdated');
        Notify.danger(textError);
      }
    }
  });

  $('#reportNoticeOffer').off('.noticeFileDetailsOffer')
    .on('show.bs.modal.noticeFileDetailsOffer', function () { Session.set('reportNoticeOfferMsg'); })
    .on('hidden.bs.modal.noticeFileDetailsOffer', function () { Session.set('reportNoticeOfferMsg'); });
});

Template.noticeFileDetailsOffer.onDestroyed(function () {
  $('#reportNoticeOffer').off('.noticeFileDetailsOffer');
});

Template.noticeFileDetailsOffer.events({
  'submit #reportNoticeOfferForm': function (event) {
    event.preventDefault();
  }
});

Template.noticeFileDetailsOffer.helpers({

  reportNoticeOfferMsgType: function () {
    let msg = Session.get('reportNoticeOfferMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  reportNoticeOfferMsg: function () {
    return Session.get('reportNoticeOfferMsg');
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  projectList: function () {
    return Session.get('companyProjects');
  }
});
