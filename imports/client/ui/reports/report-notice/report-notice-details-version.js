import {Blaze} from 'meteor/blaze';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';

const MODAL = '#reportNoticeVersion';
const FORM = '#reportNoticeVersionForm';

// 1. Module-level variable for data context
let _data = null;

// 2. Submit logic as plain function (no async/await per CLAUDE.md)
function submitHandler() {
  if (_data && _data.updateNoticeFile) {
    _data.updateNoticeFile({
      '$set': {
        version: Session.get('semanticVersionUpdate')
      }
    }, _data.noticeFile);
  }
  $(MODAL).modal('hide');
}

Template.noticeFileDetailsVersion.helpers({
  freezeMsg: function () {
    return Session.get('freezeMsg');
  }
});

// 3. Click handler: save data context, show modal, bind validation on shown
$(document).on('click', '.open-notice-version-modal', function (e) {
  e.preventDefault();
  const modalEl = document.querySelector(MODAL);
  if (modalEl) {
    const view = Blaze.getView(modalEl);
    if (view) {
      _data = Blaze.getData(view);
    }
  }
  Meteor.setTimeout(function () {
    const modal = $(MODAL);
    modal.modal('show');
    modal.off('shown.bs.modal.noticeVersionInit').on('shown.bs.modal.noticeVersionInit', function () {
      const form = $(FORM);
      if (form.length) {
        form.validate({
          submitHandler: submitHandler
        });
      }
    });
  }, 1);
});

// 4. Cleanup on modal hidden
$(document).on('hidden.bs.modal', MODAL, function () {
  Session.set('semanticVersionUpdate');
});
