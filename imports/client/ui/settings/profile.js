/* global setTimeout:false, swal:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Random} from 'meteor/random';
import {moment} from 'meteor/momentjs:moment';
import {Spacebars} from 'meteor/spacebars';
import {Accounts} from 'meteor/accounts-base';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import { i18n } from 'meteor/universe:i18n';
import Utils from '/imports/lib/utils';
import UserExtUtils from '/imports/lib/userExtUtils';
import {UserSchema} from '/imports/lib/schemas/userSchema';
import {userNameProblem, normalizeUserName, USER_NAME_MESSAGES} from '/imports/lib/user/nameValidation';
import {ReactiveVar} from 'meteor/reactive-var';
import QRCode from 'qrcodejs2';
import {Config} from '/imports/config';

const OLD_PWD = '[name=oldPassword]'
const CUR_PWD = '[name=password]'
const REP_PWD = '[name=rptPassword]'
const KEY_UPDATE = 'updateApiKeyByUser'

Template.profile.onCreated(function () {
  Session.set('profileEditErrors', {});
  this.twoFactorEnabled = new ReactiveVar(false);
  this.isPasswordUser = new ReactiveVar(false);
  this.twofaSetupDone = new ReactiveVar(false);
  this.twofaSecret = new ReactiveVar(null);
  this.twofaSetupError = new ReactiveVar(null);

  const instance = this;
  Accounts.has2faEnabled(function (err, isEnabled) {
    if (!err) instance.twoFactorEnabled.set(!!isEnabled);
  });
  Meteor.callAsync('hasPasswordService').then(function (result) {
    instance.isPasswordUser.set(!!result);
  });
});
Template.profile.onRendered(function () {
  const tplInstance = this;
  $('[data-toggle=popover]').popover();

  $('.email-settings').iCheck({
    checkboxClass: 'icheckbox_square-green',
    radioClass: 'iradio_square-green'
  });

  $.validator.addMethod('regex', function(value, element, regexpr) {
    return regexpr.test(value);
  }, 'Your text does not match requirements');

  $('#changePasswordForm').validate({
    rules: {
      oldPassword: {
        required: true,
        minlength: 1
      },
      password: {
        required: true,
        minlength: 12,
        regex: Utils.PaswordRegExp
      },
      rptPassword: {
        required: true,
        minlength: 12,
        regex: Utils.PaswordRegExp,
        equalTo: '#password'
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
      const oldPasswd = $(form).find(OLD_PWD).val();
      const newPasswd = $(form).find(CUR_PWD).val();
      Accounts.changePassword(oldPasswd, newPasswd, function (error) {
        if (error) {
          Session.set('chgPwdMsg', 'Error: ' + (error.reason || ' could not change your password'));
        } else {
          Session.set('chgPwdMsg', 'Your Password has been changed!');
          Meteor.setTimeout(function () {
            $('#changePwd').modal('hide');
          }, 2000);
        }
      });
    }
  });
  Meteor.callAsync('getApiKeysByUser').then(function(apiKeys) {
    if(apiKeys){
      Session.set('getApiKeysByUser', apiKeys);
    }
  })

  $('#changePwd').off('.profileChangePwd')
    .on('show.bs.modal.profileChangePwd', function (e) {
      $('#changePasswordForm').validate().resetForm();
      $(e.target).find(OLD_PWD).val('').removeClass('error');
      $(e.target).find(CUR_PWD).val('').removeClass('error');
      $(e.target).find(REP_PWD).val('').removeClass('error');
      Session.set('chgPwdMsg');
    })
    .on('hidden.bs.modal.profileChangePwd', function () {
      Session.set('chgPwdMsg');
    });

  $('#setup2fa').off('.profileSetup2fa')
    .on('hidden.bs.modal.profileSetup2fa', function () {
      tplInstance.twofaSetupDone.set(false);
      tplInstance.twofaSecret.set(null);
      tplInstance.twofaSetupError.set(null);
      $('#twofa-qrcode').empty();
    });
});

Template.profile.onDestroyed(function () {
  Session.set('profileEditErrors');
  $('#changePwd').off('.profileChangePwd');
  $('#setup2fa').off('.profileSetup2fa');
});

function handleTwofaVerify(instance) {
  let code = $('#twofaVerifyCode').val();
  Accounts.enableUser2fa(code, function (err2) {
    if (err2) {
      instance.twofaSetupError.set(i18n.__('InvalidTwoFactorCode'));
    } else {
      instance.twoFactorEnabled.set(true);
      instance.twofaSetupDone.set(true);
      Notify.success(i18n.__('TwoFactorSetupComplete'));
    }
  });
}

Template.profile.events = {
  'submit #changePasswordForm': function (e) {
    e.preventDefault();
    // console.log('changePasswordForm submitted:', oldPasswd, newPasswd);
  },

  'click .enable-2fa': function (event) {
    event.preventDefault();
    const instance = Template.instance();

    instance.twofaSetupDone.set(false);
    instance.twofaSetupError.set(null);
    instance.twofaSecret.set(null);

    Accounts.generate2faActivationQrCode(Config.name, function (err, result) {
      if (err) {
        Notify.danger(err.reason || 'Could not generate 2FA code');
        return;
      }
      instance.twofaSecret.set(result.secret);

      let modal = $('#setup2fa');
      modal.modal('show');
      modal.off('shown.bs.modal.twofaInit').on('shown.bs.modal.twofaInit', function () {
        let qrContainer = document.getElementById('twofa-qrcode');
        if (qrContainer) {
          qrContainer.innerHTML = '';
          new QRCode(qrContainer, {
            text: result.uri,
            width: 200,
            height: 200
          });
        }
        let form = $('#verify2faForm');
        if (form.length) {
          form.validate({
            rules: {
              twofaVerifyCode: {
                required: true,
                minlength: 6,
                maxlength: 6,
                digits: true
              }
            },
            errorElement: 'span',
            submitHandler: handleTwofaVerify.bind(null, instance)
          });
        }
      });
    });
  },

  'click .disable-2fa': function (event) {
    event.preventDefault();
    const instance = Template.instance();

    swal({
      title: i18n.__('Disable2fa'),
      text: 'Are you sure you want to disable two-factor authentication?',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#DD6B55',
      confirmButtonText: 'Yes, disable it',
      cancelButtonText: 'Cancel'
    }, function (confirmed) {
      if (confirmed) {
        Accounts.disableUser2fa(function (err) {
          if (err) {
            Notify.danger(err.reason || 'Could not disable 2FA');
          } else {
            instance.twoFactorEnabled.set(false);
            Notify.success('Two-factor authentication disabled');
          }
        });
      }
    });
  },

  'submit #verify2faForm': function (event) {
    event.preventDefault();
  }
};

Template.profile.helpers({
  chgPasswordMsgType: function () {
    const msg = Session.get('chgPwdMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },
  chgPasswordMsg: function () {
    return Session.get('chgPwdMsg');
  },
  getLogin: function () {
    const user = Meteor.user();
    if (!user) return '';
    return user.emails && user.emails[0] ? user.emails[0].address : (user.profile && user.profile.login) || '';
  },
  twoFactorEnabled: function () {
    return Template.instance().twoFactorEnabled.get();
  },
  isPasswordUser: function () {
    return Template.instance().isPasswordUser.get();
  },
  twofaSetupDone: function () {
    return Template.instance().twofaSetupDone.get();
  },
  twofaSecret: function () {
    return Template.instance().twofaSecret.get();
  },
  twofaSetupError: function () {
    return Template.instance().twofaSetupError.get();
  }
});

Template.user.helpers({
  userRoles: function () {
    const user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    const roles = companyId ? Roles.getRolesForUser(user, {scope: companyId}) : [];
    return _.chain(roles)
      .map(function (role) {
        const roleDetails = _.find(UserExtUtils.allRoles(), function (availableRole) {
          return availableRole.key === role;
        });
        return roleDetails && roleDetails.label;
      })
      // Drop roles with no display label (e.g. a leftover assignment to a role
      // that no longer exists) so they don't render as empty segments.
      .filter(Boolean)
      .value()
      .join(', ');
  },
  getApiKeysByUser: function () {
    return Session.get('getApiKeysByUser');
  },
  errorMessage: function (field) {
    return Session.get('profileEditErrors')[field];
  },
  errorClass: function (field) {
    return Session.get('profileEditErrors')[field] ? 'has-error' : '';
  },
  ariaInvalid: function (field) {
    return Session.get('profileEditErrors')[field] ? 'true' : 'false';
  },
  getLogin: function () {
    return this.emails && this.emails[0] ? this.emails[0].address : this.profile.login || '';
  },
  isNotificationChecked: function (key) {
    const notifications = this.profile.notifications;
    return notifications && _.contains(notifications, key) ? 'checked' : '';
  },
  isSelected: function (value, key) {
    return value === key;
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  },
  reactiveTableSettings: function () {
    let list = this.filter((item)=>{
      return !item.deleted
    })
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
            // The server now computes+stores a maskedKey (key is
            // encrypted, no longer usable for client-side masking). Fall back
            // to the legacy client-side mask only for a pre-migration entry
            // that still carries a plaintext key.
            return object.maskedKey || getVisibleKey(value)
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
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          cellClass: 'text-right',
          tmpl: Template.reactiveTablePersonalApiKeyActions
        }
      ]
    };
  }
});

Template.user.events = {
  'click .profile-logout': function (event) {
    event.preventDefault();
    Meteor.logout(function () {
      Router.go('home');
    });
  },
  'click .create_api_key': function (e) {
    e.preventDefault();
    if (Session.get('requestInProgress')) {
      return;
    }
    Session.set('requestInProgress', true);
    // Marks this one intent so the server dedupes a replay of it (Meteor
    // re-sends outstanding method calls after a dropped connection) instead of
    // minting a second key. Rotated per click.
    const requestId = Random.id();
    Meteor.callAsync('createApiKeyByUser', {requestId}).then(function(apiKey) {
      if(apiKey) {
        const user = Meteor.user();
        let keys = Session.get('getApiKeysByUser')
        keys.unshift(apiKey)
        Session.set('getApiKeysByUser', keys);
        Notify.success('Api key created');
        Meteor.callAsync('logEvent', user, 'Api key '+apiKey.maskedKey+' created', 'apiKeyProcessing');
      }
    }).catch(function(error) {
      Notify.danger(error.message);
    }).finally(function() {
      // Was only cleared on success, so a failed create left the button
      // spinning and disabled until the page was reloaded.
      Session.set('requestInProgress');
    })
  },
  'submit .main': function (e) {
    e.preventDefault();
    const user = Meteor.user();
    if (user) {
      const nameProblem = userNameProblem($(e.target).find('[name=name]').val());
      if (nameProblem) {
        // The schema only reports a generic "Validation failed" for this, and lets a
        // whitespace-only name through, so say what is wrong next to the field.
        Session.set('profileEditErrors', {name: USER_NAME_MESSAGES[nameProblem]});
        $(e.target).find('[name=name]').trigger('focus');
        return;
      }
      Session.set('profileEditErrors', {});
      try {
        const userName = normalizeUserName($(e.target).find('[name=name]').val()),
          userEmail = $(e.target).find('[name=email]').val(),
          userTheme = $(e.target).find('[name=theme]').val(),
          userLang = $(e.target).find('[name=lang]').val();

        UserSchema.validate({
          profile: {
            name: userName,
            email: userEmail,
            theme: userTheme,
            locale: userLang
          }
        });

        Meteor.callAsync('updateUserProfile', {
          'profile.name': userName,
          'profile.email': userEmail,
          'profile.theme': userTheme,
          'profile.locale': userLang
        }).then(function () {
          i18n.setLocale(userLang);
          setTimeout(function () {
            Notify.success('Profile settings changed');
          });
        }).catch(function (error) {
          if(error.reason === 'INVALID'){
            Notify.danger('Validation failed, please ensure you are entering valid data');
          }else{
            Notify.danger(error.reason || error.message);
          }
        });
      }catch (e){
        // A SimpleSchema validation error has no `reason`, and Notify.danger(undefined)
        // throws inside Utils.format, so the user saw nothing at all.
        Notify.danger(e.reason || 'Validation failed, please ensure you are entering valid data');
      }
    }
  },
  'submit .communication_form': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    if (user) {
      let checkboxes = $('.communication_form').find('.email-settings:checked');
      let notifications = checkboxes ? checkboxes.map(function () {
        return this.value;
      }).toArray() : [];

      Meteor.callAsync('updateUserProfile', {
        'profile.notifications': notifications
      }).then(function () {
        setTimeout(function () {
          Notify.success('Profile settings changed');
        });
      }).catch(function (error) {
        if(error.reason === 'INVALID'){
          Notify.danger('Validation failed, please ensure you are entering valid data');
        }else{
          Notify.danger(error.message);
        }
      }
      );
    }
  }
};

Template.reactiveTablePersonalApiKeyActions.events = {
  // The key is encrypted server-side and never sent to the client, so
  // copying it now reveals-on-demand (decrypts + audit-logs the copy
  // server-side via apiKey.reveal) instead of reading a plaintext
  // data-clipboard-text attribute.
  'click .copy-api-key': function () {
    const id = this.id;
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
      Notify.danger((error && error.reason) || (error && error.message) || 'Could not copy to clipboard');
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
  },

  'click .publish-api-key': async function() {
    const self = this;
    self.published = true;
    self.unpublished = false;
    Meteor.callAsync(KEY_UPDATE, self).then(function(apiKey) {
      const user = Meteor.user();
      if(apiKey) {
        let keys = Session.get('getApiKeysByUser')
        keys = keys.map((item)=>{
          if(item.id === apiKey.id) {
            return apiKey;
          }
          return item;
        })
        Session.set('getApiKeysByUser', keys)
      }
      Notify.success('Api key published');
      Meteor.callAsync('logEvent', user, 'Api key '+self.maskedKey+' published', 'apiKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'apiKeyProcessing');
    });
  },

  'click .unpublish-api-key': function () {
    const self = this;
    self.published = false;
    self.unpublished = true;
    Meteor.callAsync(KEY_UPDATE, self).then(function(apiKey) {
      const user = Meteor.user();
      if(apiKey) {
        let keys = Session.get('getApiKeysByUser')
        keys = keys.map((item)=>{
          if(item.id === apiKey.id) {
            return apiKey;
          }
          return item;
        })
        Session.set('getApiKeysByUser', keys)
      }
      Notify.success('Api key unpublished');
      Meteor.callAsync('logEvent', user, 'Api key '+self.maskedKey+' unpublished', 'apiKeyProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'apiKeyProcessing');
    });
  }
}


function getVisibleKey(apiKey){
  if(apiKey){
    let newKey = apiKey.split('-');
    return `${newKey[0].substring(0, 4)}...${newKey[newKey.length - 1].slice(-4)}`
  }
}
