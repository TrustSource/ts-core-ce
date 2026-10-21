import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {Blaze} from 'meteor/blaze';
import Notify from '/imports/api/notify';

const FORM = '#productEditPhotosForm'
const LOADING = 'loadingInProgress'

Template.productEditPhotos.events({
  'submit #productEditPhotosForm': function (event) {
    event.preventDefault();
  },
  'click .remove_picture': function (event) {
    event.preventDefault();
    const self = Blaze.getData($(FORM)[0]);
    const currentFanGalleryIndex = Session.get('currentFanGalleryIndex') || 0
    Session.set(LOADING, true)
    Meteor.callAsync('Products.PictureRemove', {
      file: self.documents.photos[currentFanGalleryIndex],
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
  'change [name=file]': function (event) {
    event.preventDefault();
    const self = Blaze.getData($(FORM)[0]);
    const file = $(FORM).find('[name=file]')[0].files[0];
    const validExtensions = ['jpg','jpeg','png','webp','gif','avif','svg','heic','heif'];
    const fileName = file.name;
    const fileExtension = file.name.slice(file.name.lastIndexOf('.')+1).toLowerCase();
    if (!validExtensions.includes(fileExtension)) {
      Notify.danger('Invalid file type. Please upload a valid image.');
      Session.set(LOADING)
      return;
    }
    Session.set(LOADING, true)
     
    const reader = new FileReader();
    reader.onload = function (event) {
      const arrayBuffer = event.target.result;
       
      const uint8 = new Uint8Array(arrayBuffer);
      Meteor.callAsync('Products.PictureUpload', {
        file:{
          fileName: fileName,
          fileExtension: fileExtension,
          mimeType: file.type,
          data: Array.from(uint8)
        }, product: {
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
    };

    reader.readAsArrayBuffer(file);
  }
});

Template.productEditPhotos.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  isSelected: function (item, value) {
    return item === value;
  },
  getMappedPhotos: function () {
    return this.documents && this.documents.photos && this.documents.photos.map(function (photo) {
      return photo.url;
    })
  }
});
