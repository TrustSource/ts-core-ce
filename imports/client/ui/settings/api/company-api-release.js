import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import Approves from '/imports/lib/collections/approves';

const SELECT_2_PLACEHOLDER = 'Api key usage scope'

// Note: this template no longer wires up clipboard.js. It previously bound
// `new Clipboard('.copy-api-key')`, but that selector matches no button in this
// template - the only `.copy-api-key` buttons live on the company and
// personal API-key pages, which now copy via reveal-on-demand + navigator.
// clipboard. clipboard.js delegates from `document`, so that stale (and never
// destroyed) binding fired spurious "copied" toasts / clobbered the selection
// on those real reveal buttons.

Template.companyApiReleases.onRendered(function () {
  Meteor.setTimeout(()=>{
    $('.select2').select2({
      placeholder: SELECT_2_PLACEHOLDER,
      width: '100%'
    });
  }, 100)
});

Template.companyApiReleases.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  haveFiles: function () {
    return Approves.find({}).count() > 0;
  }
});

Template.companyApiReleases.events({
  'click .create-public-release-key': function () {
    let list = Approves.findOne({}, {sort: {approved: -1}});
    let tempId = list && list._id
    Meteor.callAsync('publicReleaseKey.create', tempId).then(function (data) {
      const user = Meteor.user();
      Notify.success('Public Release key created');
      Meteor.callAsync('logEvent', user, 'New Public Release key ' + data.maskedKey + ' created', 'publicReleaseKeyProcessing');
      Meteor.setTimeout(() => {
        $('.public-release-scope').last().select2({
          placeholder: SELECT_2_PLACEHOLDER,
          width: '100%'
        });
      }, 100)
    }).catch(function (error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: ' + error.message, 'publicReleaseKeyProcessing');
    });
  }
});

