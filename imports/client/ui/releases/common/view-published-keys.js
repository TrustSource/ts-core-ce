
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import {Meteor} from 'meteor/meteor';
import Notify from '/imports/api/notify';
import {copyRevealedKey} from '/imports/client/ui/common/reveal-copy';
import {Blaze} from 'meteor/blaze';
import {$} from 'meteor/jquery';
import {requestCount} from '/imports/lib/companies/publicKeyRequests';

const PUBLIC_NK = 'Public key '
const VEX_UPDATE = 'publicReleaseKey.update'
const VIEW_NAME = '#viewPublishedKeys'

Template.viewPublishedKeys.onCreated(function () {
  let loading = new ReactiveVar();
  let details = new ReactiveVar();
  this.details = details;
  this.loading = loading;
});

function fetchData(instance) {
  instance.loading.set(true)
  let params = {
    releaseId: instance.data.params.approveId
  }
  Meteor.callAsync('publicReleaseKey.find', params).then(data => {
    if(data){
      instance.details.set(data)
    }
    instance.loading.set(false)
  })
}

Template.viewPublishedKeys.onRendered(function () {
  const instance = this;
  const modal = $(VIEW_NAME);
  modal.off('click.createKey').on('click.createKey', '.create-new-key', function () {
    const approveId = instance.data && instance.data.params && instance.data.params.approveId;
    Meteor.callAsync('publicReleaseKey.create', approveId).then(data => {
      if(data){
        Notify.success('Key created');
        fetchData(instance)
      }
      instance.loading.set(false)
    }).catch(function(error) {
      Notify.danger(error.message || 'Failed to create key');
      instance.loading.set(false)
    })
  });
});

Template.viewPublishedKeys.events({
  'mouseenter .view-published-vex' () {
    const instance = Template.instance();
    if(instance.data && instance.data.params && instance.details && !instance.details.get()){
      fetchData(instance)
    }
  }
})

Template.viewPublishedKeys.helpers({
  loading: function () {
    const template = Template.instance();
    return template.loading.get()
  },
  reactiveTableSettings: function () {
    const instance = Template.instance();
    return {
      collection: (instance && instance.details && instance.details.get()) || [],
      rowsPerPage: 15,
      showFilter: true,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'published',
          key: 'published',
          label: 'Published',
          tmpl: Template.reactiveTableKeyStatus
        },
        {
          fieldId: 'key',
          key: 'key',
          label: 'Key',
          tmpl: Template.reactiveTableKeyCopy
        },
        {
          fieldId: 'requests',
          key: 'requests',
          label: 'Requests',
          sortOrder: 0,
          sortDirection: 'descending',
          fn: function (value, key) {
            return requestCount(key);
          }
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: 'Actions',
          tmpl: Template.reactiveTableVexKeyActions
        }
      ]
    };
  }
});

Template.reactiveTableKeyStatus.helpers({
  getStatusPublished: function () {
    return this.published
  },
  getStatusUnpublished: function () {
    return this.unpublished
  }
});

Template.reactiveTableKeyCopy.helpers({
  getStatusPublished: function () {
    return this.published
  }
});

Template.reactiveTableVexKeyActions.helpers({
  getStatusPublished: function () {
    return this.published
  },
  getStatusUnpublished: function () {
    return this.unpublished
  }
});

Template.reactiveTableVexKeyActions.events({
  'click .copy-public-key': function () {
    copyRevealedKey('publicReleaseKey.reveal', this.id);
  },

  'click .publish-public-key': function () {
    const self = this;
    self.published = true;
    self.unpublished = false;
    Meteor.callAsync(VEX_UPDATE, self).then(function() {
      const user = Meteor.user();
      Notify.success('Public CSAF key published');
      Meteor.callAsync('logEvent', user, PUBLIC_NK+self.maskedKey+' published', 'publicReleaseKeyProcessing');
      const instance = Blaze.getView($(VIEW_NAME)[0]).templateInstance();
      fetchData(instance)
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'publicReleaseKeyProcessing');
    });
  },

  'click .delete-public-key': function () {
    const self = this;
    if(self.requests.length){
      self.unpublished = true;
      Meteor.callAsync(VEX_UPDATE, self).then(function() {
        const user = Meteor.user();
        Notify.success('Public CSAF key unpublished');
        Meteor.callAsync('logEvent', user, PUBLIC_NK+self.maskedKey+' unpublished', 'publicReleaseKeyProcessing');
        const instance = Blaze.getView($(VIEW_NAME)[0]).templateInstance();
        fetchData(instance)
      }).catch(function(error) {
        const user = Meteor.user();
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'publicReleaseKeyProcessing');
      });
    }else{
      Meteor.callAsync('publicReleaseKey.delete', self.id).then(function() {
        const user = Meteor.user();
        Notify.success('Public CSAF key deleted');
        Meteor.callAsync('logEvent', user, PUBLIC_NK+self.maskedKey+' removed', 'publicReleaseKeyProcessing');
        const instance = Blaze.getView($(VIEW_NAME)[0]).templateInstance();
        fetchData(instance)
      }).catch(function(error) {
        const user = Meteor.user();
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'publicReleaseKeyProcessing');
      });
    }
  }
});

