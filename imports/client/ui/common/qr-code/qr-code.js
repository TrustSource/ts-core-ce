/* global document:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import QRCode from 'qrcodejs2';
import Clipboard from 'clipboard';
import Notify from '/imports/api/notify';

Template.qrCode.onRendered(function () {
  new QRCode(document.getElementById('qrcode'), this.data.link);
  Meteor.setTimeout(()=>{
    let clipboard = new Clipboard('.copy-qr-code');
    clipboard.on('success', function (e) {
      Notify.success('Url was successfully copied');
      e.clearSelection();
    });
  }, 100)
});
