import {Blaze} from 'meteor/blaze';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';

const MODAL = '#reportSbomVersion';
const FORM = '#reportSbomVersionForm';

// 1. Module-level variable for data context
let _data = null;

// 2. Submit logic as plain function (no async/await per CLAUDE.md)
function submitHandler() {
  if (_data && _data.updateSbomFile) {
    _data.updateSbomFile({
      '$set': {
        version: Session.get('semanticVersionUpdate')
      }
    }, _data.sbomFile);
  }
  $(MODAL).modal('hide');
}

Template.sbomFileDetailsVersion.helpers({
  freezeMsg: function () {
    return Session.get('freezeMsg');
  }
});

// 3. Click handler: save data context, show modal, bind validation on shown
$(document).on('click', '.open-version-modal', function (e) {
  e.preventDefault();
  // Get data from the sub-template's DOM element
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
    modal.off('shown.bs.modal.versionInit').on('shown.bs.modal.versionInit', function () {
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
