/* global document, swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import _ from 'underscore';
import {moment} from 'meteor/momentjs:moment';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import {Spacebars} from 'meteor/spacebars';
import {escapeHtml} from '/imports/lib/html/tableCells';

const KEY_UPDATE = 'apiKey.update'
const SELECT_2_PLACEHOLDER = 'Api key usage scope'

Template.companyApiKeys.onCreated(function () {
  Session.set('apiKeyCreateDisabled');
  // Requests per key over the last 30 days ({keyId: {total, days}}).
  this.usage = new ReactiveVar({});
  Meteor.callAsync('apiKey.usage').then((usage) => {
    this.usage.set(usage || {});
  }).catch(() => {
    this.usage.set({});
  });
});

// "123" with the busiest days in the title, for the Requests column.
function usageCell(entry) {
  if (!entry || !entry.total) {
    return Spacebars.SafeString('<span class="text-muted">0</span>');
  }
  const days = Object.keys(entry.days).sort().reverse().slice(0, 7)
    .map((day) => `${day}: ${entry.days[day]}`).join('\n');
  return Spacebars.SafeString(
    `<span title="${escapeHtml('Requests on the last days used:\n' + days)}">${entry.total}</span>`);
}

Template.companyApiKeys.onRendered(function () {
  Meteor.setTimeout(()=>{
    $('.select2').select2({
      placeholder: SELECT_2_PLACEHOLDER
    });
  }, 1)
});

Template.companyApiKeys.helpers({
  getApiKeys: function () {
    const apiKeys = this.apiKeys || [];
    const list = _.sortBy(_.map(apiKeys, function (value, index) {
      value.index = index;
      return value
    }),'lastUsedDate');
    return Session.get('sortOrder') === 'asc' ? list : list.reverse()
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  reactiveTableSettings: function () {
    let list = this.filter((item)=>{
      return !item.deleted
    })
    const usage = Template.instance().usage.get();
    return {
      collection: list,
      rowsPerPage: Template.instance().currentLimit,
      currentPage: Template.instance().currentPage,
      showFilter: true,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'created',
          key: 'created',
          label: 'Created',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell,
          sortFn: function (value) {
            return !value ? new Date('1990-01-01'): value
          }
        },
        {
          fieldId: 'index',
          key: 'index',
          label: 'Number',
          cellClass: 'col-80',
          fn: function (value) {
            return +value+1
          }
        },
        {
          fieldId: 'key',
          key: 'key',
          label: 'Key (partial view)',
          sortOrder: 0,
          sortDirection: 'ascending',
          cellClass: 'col-200',
          fn: function (value, object) {
            if(!object.published){
              return 'Key available after publish'
            }
            return object.maskedKey
          }
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name'
        },
        {
          fieldId: 'scope',
          key: 'scope',
          label: 'Scopes',
          fn: function (value) {
            return value && value.join(', ');
          }
        },
        {
          fieldId: 'userId',
          key: 'userId',
          label: 'PAK',
          tmpl: Template.reactiveTablePAKCheck,
          cellClass: 'col-40',
          fn: function (value) {
            return !value
          },
          sortFn: function (value) {
            return !value
          }
        },
        {
          fieldId: 'lastUsedDate',
          key: 'lastUsedDate',
          label: 'Last used',
          cellClass: 'col-date',
          fn: function (value){
            function lastUsedClass(day) {
              let today = new Date();
              const dayDiff = -moment(day).diff(today, 'days');
              let labelClass = 'label-success'
              if(dayDiff > 14 && dayDiff < 28){
                labelClass = 'label-warning'
              }else if(dayDiff >= 28 && dayDiff <= 42){
                labelClass = 'label-orange'
              }else if(dayDiff > 42){
                labelClass = 'label-danger'
              }
              return labelClass
            }
             
            return value ? Spacebars.SafeString(`<div class="label ${lastUsedClass(value)} label-lg">${moment(value).format('L')}</div>`) : ''
          }
        },
        {
          fieldId: 'usage',
          key: 'id',
          label: 'Requests (30 days)',
          cellClass: 'col-80',
          fn: function (value) {
            return usageCell(usage[value]);
          },
          sortFn: function (value) {
            return usage[value] ? usage[value].total : 0;
          }
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          cellClass: 'col-330',
          tmpl: Template.reactiveTableApiKeyActions
        }
      ]
    };
  }
});

Template.companyApiKeys.events({
  'change .api-key-name': function (event) {
    const self = this;
    self.name = $(event.target).val();
    Meteor.callAsync(KEY_UPDATE, self).then(function() {
      const user = Meteor.user();
      Notify.success('Api key updated');
      Meteor.callAsync('logEvent', user, 'Api key '+self.maskedKey+' updated', 'apiKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'apiKeyProcessing');
    });
  },

  'change .api-key-scope': function (event) {
    const self = this;
    self.scope = $(event.target).val();
    Meteor.callAsync(KEY_UPDATE, self).then(function() {
      const user = Meteor.user();
      Notify.success('Api key updated');
      Meteor.callAsync('logEvent', user, 'Api key '+self.maskedKey+' updated', 'apiKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'apiKeyProcessing');
    });
  },

  'click .publish-api-key': async function() {
    const self = this;
    self.published = true;
    self.unpublished = false;
    Meteor.callAsync(KEY_UPDATE, self).then(function() {
      const user = Meteor.user();
      Notify.success('Api key published');
      Meteor.callAsync('logEvent', user, 'Api key '+self.maskedKey+' published', 'apiKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'apiKeyProcessing');
    }).finally(function() {
      Meteor.setTimeout(()=>{
        $('.select2').select2({
          placeholder: SELECT_2_PLACEHOLDER,
          width: '100%'
        });
      }, 100)
    });
  },

  'click .unpublish-api-key': function () {
    const self = this;
    self.published = false;
    self.unpublished = true;
    Meteor.callAsync(KEY_UPDATE, self).then(function() {
      const user = Meteor.user();
      Notify.success('Api key unpublished');
      Meteor.callAsync('logEvent', user, 'Api key '+self.maskedKey+' unpublished', 'apiKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'apiKeyProcessing');
    }).finally(function() {
      Meteor.setTimeout(()=>{
        $('.select2').select2({
          placeholder: SELECT_2_PLACEHOLDER,
          width: '100%'
        });
      }, 1)
    });
  },

  'click .delete-api-key': function () {
    const self = this;
    self.published = false;
    self.unpublished = false;
    self.deleted = true;
    swal({
      title: `Delete the key ${escapeHtml(self.name || '')} permanently? You can't undo this action.`,
      text: `To confirm this deletion, enter key name “${escapeHtml(self.name || '')}”.<br>` +
        '<textarea id=\'confirmationText\' class="form-control inner-t-5 no-resize" rows="1"></textarea>',
      html: true,
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    }, function (reason) {
      if(reason === false) return false;
      reason = document.getElementById('confirmationText').value;
      if(reason || (!reason && !self.name)){
        if(reason !== self.name){
          Notify.warn('Key name is not matching user input');
        }else{
          Meteor.callAsync(KEY_UPDATE, self).then(function() {
            const user = Meteor.user();
            Notify.success('Api key deleted');
            Meteor.callAsync('logEvent', user, 'Api key '+self.maskedKey+' deleted', 'apiKeyProcessing');
          }).catch(function(error) {
            const user = Meteor.user();
            Notify.danger(error.message);
            Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'apiKeyProcessing');
          }).finally(function() {
            Meteor.setTimeout(()=>{
              $('.select2').select2({
                placeholder: SELECT_2_PLACEHOLDER
              });
            }, 1)
          });
        }
      }else{
        Notify.warn('Key name is required');
      }
    });
  },

  'click .copy-api-key': function (event) {
    const id = $(event.currentTarget).data('id');
    // The clipboard write must stay tied to THIS click's user activation.
    // apiKey.reveal is a server round-trip (decrypt + audit-log), so we cannot
    // await it and THEN write - by the time it resolves the activation window
    // is gone and browsers (Safari especially) reject the write with
    // NotAllowedError ("...not allowed by the user agent..."). Instead, hand the
    // clipboard a promise for the text so the write is authorized now and the
    // key is filled in when the reveal resolves.
    let reported = false;
    const notifyFailure = function (error) {
      if (reported) {
        return;
      }
      reported = true;
      Notify.danger((error && error.reason) || (error && error.message) || 'Unable to copy API key');
    };
    const reveal = Meteor.callAsync('apiKey.reveal', id).then(function (plainKey) {
      // `new Blob([undefined])` does not throw - it stringifies to the literal
      // text "undefined", which the clipboard write then reports as a success.
      // So prove the revealed key is a non-empty string before it can reach
      // the clipboard.
      if (typeof plainKey !== 'string' || plainKey.length === 0) {
        throw new Error('The key could not be read - please reload the page and try again');
      }
      return plainKey;
    });
    // The Clipboard API replaces any rejection of the ClipboardItem promise
    // with a generic DOMException, so report the reveal's own reason (e.g. the
    // server explaining that the stored value could not be decrypted) here,
    // where it is still intact. `reported` keeps this to one toast.
    reveal.catch(notifyFailure);
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
      const text = reveal.then(function (plainKey) {
        return new Blob([plainKey], {type: 'text/plain'});
      });
      navigator.clipboard.write([new ClipboardItem({'text/plain': text})]).then(function () {
        Notify.success('Information was successfully copied');
      }).catch(notifyFailure);
    } else {
      // Fallback for browsers without async ClipboardItem support (older Firefox).
      reveal.then(function (plainKey) {
        return navigator.clipboard.writeText(plainKey);
      }).then(function () {
        Notify.success('Information was successfully copied');
      }).catch(notifyFailure);
    }
  }
});

