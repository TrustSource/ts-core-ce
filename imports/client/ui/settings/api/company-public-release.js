import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import {copyRevealedKey} from '/imports/client/ui/common/reveal-copy';
import Approves from '/imports/lib/collections/approves';


const RELEASE_UPDATE = 'publicReleaseKey.update'
const PUBLIC_NK = 'Public Release key '
const NF = 'Error: Release file is not found'

Template.companyPublicRelease.helpers({
  getApiKeys: function () {
    const apiKeys = this.publicReleaseKeys || [];
    return _.map(apiKeys, function (value, index) {
      value.index = index;
      return value
    });
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  files: function () {
    return Approves.find({},{sort:{approved:-1}}).fetch();
  },
  haveFiles: function () {
    let list = Approves.find({}).count();
    return list > 0;
  },
  isActive:function () {
    let keyItem = Template.parentData();
    return keyItem.releaseId === this._id
  },
  previewData:function () {
    return JSON.stringify(Session.get('previewData'), null, '\t')
  },
  qrData:function () {
    return Session.get('qrData')
  },
  apiKeyScopes: function () {
    return ['sbom','notice','csaf']
  },
  isSelectedScope: function (scope) {
    let keyScope = this.toString()
    return scope && scope.indexOf(keyScope) > -1
  }
});

// The QR code links carry the key itself, which only the server can read.
function showQrCode(id, path) {
  Session.set('qrData');
  Meteor.callAsync('publicReleaseKey.reveal', id).then(function (plainKey) {
    Session.set('qrData', Meteor.absoluteUrl(`api/v2/compliance/releases/${plainKey}/${path}/`));
  }).catch(function (error) {
    Notify.danger(error.reason || error.message);
  });
}

Template.companyPublicRelease.onRendered(function () {
  const clearPreview = function () { Session.set('previewData'); };
  const clearQr = function () { Session.set('qrData'); };
  $('#companyPublicVex').off('.companyPublicRelease').on('hidden.bs.modal.companyPublicRelease', clearPreview);
  $('#companyPublicSbom').off('.companyPublicRelease').on('hidden.bs.modal.companyPublicRelease', clearPreview);
  $('#companyPublicNotice').off('.companyPublicRelease').on('hidden.bs.modal.companyPublicRelease', clearPreview);
  $('#qrPreview').off('.companyPublicRelease').on('hidden.bs.modal.companyPublicRelease', clearQr);
});

Template.companyPublicRelease.onDestroyed(function () {
  $('#companyPublicVex, #companyPublicSbom, #companyPublicNotice, #qrPreview').off('.companyPublicRelease');
});

Template.companyPublicRelease.events({
  'change .public-release-file': function (event) {
    const self = this;
    self.releaseId = $(event.target).val();
    Meteor.callAsync(RELEASE_UPDATE, self).then(function() {
      const user = Meteor.user();
      Notify.success('Public Release key updated');
      Meteor.callAsync('logEvent', user, PUBLIC_NK+self.maskedKey+' updated', 'publicReleaseKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'publicReleaseKeyProcessing');
    });
  },

  'change .public-release-scope': function (event) {
    const self = this;
    self.scope = $(event.target).val();
    Meteor.callAsync(RELEASE_UPDATE, self).then(function() {
      const user = Meteor.user();
      Notify.success('Public Release key updated');
      Meteor.callAsync('logEvent', user, PUBLIC_NK+self.maskedKey+' updated', 'publicReleaseKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'publicReleaseKeyProcessing');
    });
  },

  'click .publish-public-release-key': function () {
    const self = this;
    self.published = true;
    self.unpublished = false;
    Meteor.callAsync(RELEASE_UPDATE, self).then(function() {
      const user = Meteor.user();
      Notify.success('Public Release key published');
      Meteor.callAsync('logEvent', user, PUBLIC_NK+self.maskedKey+' published', 'publicReleaseKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'publicReleaseKeyProcessing');
    });
  },

  'click .delete-public-release-key': function () {
    const self = this;
    if(self.requests.length){
      self.unpublished = true;
      Meteor.callAsync(RELEASE_UPDATE, self).then(function() {
        const user = Meteor.user();
        Notify.success('Public Release key unpublished');
        Meteor.callAsync('logEvent', user, PUBLIC_NK+self.maskedKey+' unpublished', 'publicReleaseKeyProcessing');
      }).catch(function(error) {
        const user = Meteor.user();
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'publicReleaseKeyProcessing');
      });
    }else{
      Meteor.callAsync('publicReleaseKey.delete', self.id).then(function() {
        const user = Meteor.user();
        Notify.success('Public Release key deleted');
        Meteor.callAsync('logEvent', user, PUBLIC_NK+self.maskedKey+' removed', 'publicReleaseKeyProcessing');
      }).catch(function(error) {
        const user = Meteor.user();
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'publicReleaseKeyProcessing');
      });
    }
  },

  'click .preview-public-sbom': function () {
    const self = this;
    Session.set('previewData', undefined);
    Meteor.callAsync('publicBoMKey.preview', self.id).then(function(data) {
      if (!data) {
        Session.set('previewData', NF)
      } else {
        Session.set('previewData',data);
      }
    });
  },
  'click .preview-public-notice': function () {
    const self = this;
    Session.set('previewData', undefined);
    Meteor.callAsync('publicNoticeKey.preview', self.id).then(function(data) {
      if (!data) {
        Session.set('previewData', NF)
      } else {
        Session.set('previewData',data);
      }
    });
  },
  'click .preview-public-vex': function () {
    const self = this;
    Session.set('previewData', undefined);
    Meteor.callAsync('publicVexKey.preview', self.id).then(function(data) {
      if (!data) {
        Session.set('previewData', NF)
      } else {
        Session.set('previewData',data);
      }
    });
  },
  'click .copy-public-release-key': function () {
    copyRevealedKey('publicReleaseKey.reveal', this.id);
  },
  'click .qr-public-sbom': function () {
    showQrCode(this.id, 'sbom');
  },
  'click .qr-public-notice': function () {
    showQrCode(this.id, 'notice');
  },
  'click .qr-public-vex': function () {
    showQrCode(this.id, 'csaf');
  }
});

