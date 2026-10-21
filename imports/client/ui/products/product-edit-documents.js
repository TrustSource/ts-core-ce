/*global document */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';

const LOADING = 'loadingInProgress'

Template.productEditDocuments.helpers({
  loading: function () {
    return Session.get(LOADING);
  }
});

Template.productEditDocuments.events({
  'click  .remove_document': function (event) {
    event.preventDefault();
    const self = this;
    const variant = event.currentTarget.getAttribute('data-variant');
    Session.set(LOADING, true)
    Meteor.callAsync('Products.DocumentRemove', {
      file: self.documents[variant],
      documentType: variant,
      product: {
        _id: self._id
      }
    }).then(data => {
      if(data){
        Notify.success('Product updated');
      }
    }).catch(error => {
      Notify.danger(error.message);
    }).finally(() => {
      Session.set(LOADING)
    });
  },
  'click  .download_documents': function (event) {
    event.preventDefault();
    const self = this;
    const fileUrls = [];
    ['userManual', 'secureSetup', 'productDescription', 'sbom', 'cedoc'].forEach(key => {
      if (self.documents[key]) fileUrls.push(self.documents[key].url);
    });
    if(fileUrls.length > 0){
      Session.set(LOADING, true)
      Meteor.callAsync('Products.DownloadArchive', { fileUrls }).then(data => {
        const link = document.createElement('a');
        link.href = 'data:application/zip;base64,' + data.base64;
        link.download = data.fileName;
        link.click();
        Session.set(LOADING)
      }).catch(error => {
        Notify.danger(error.message);
      });
    }
  },
  'click  .download_all': function (event) {
    event.preventDefault();
    const self = this;
    const fileUrls = [];
    ['userManual', 'secureSetup', 'productDescription', 'sbom', 'cedoc'].forEach(key => {
      if (self.documents[key]) fileUrls.push(self.documents[key].url);
    });
    if (Array.isArray(self.documents.photos)) {
      fileUrls.push(...self.documents.photos.map(p => p && p.url).filter(Boolean));
    }
    if(fileUrls.length > 0){
      Session.set(LOADING, true)
      Meteor.callAsync('Products.DownloadArchive', { fileUrls }).then(data => {
        const link = document.createElement('a');
        link.href = 'data:application/zip;base64,' + data.base64;
        link.download = data.fileName;
        link.click();
        Session.set(LOADING)
      }).catch(error => {
        Notify.danger(error.message);
      });
    }
  }
});
