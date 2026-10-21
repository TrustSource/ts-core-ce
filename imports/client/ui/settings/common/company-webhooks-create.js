import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import {WEBHOOK_TRIGGERS, webhookTypeOptions as buildWebhookTypeOptions}
  from '/imports/lib/company/webhookTriggers';
import {Session} from 'meteor/session';

const WEBHOOK_TYPE_SELECT = '#webhookType'

function onWebhookTypeChange() {
  const values = $(WEBHOOK_TYPE_SELECT).select2('data');
  Meteor.setTimeout(function () {
    Session.set('webhookType', values && values[0] && values[0].id);
  }, 1);
}

function resetForm() {
  let form = $('#addWebhookForm');
  $('#createWebhook .select2').each(function () {
    if ($(this).data('select2')) {
      $(this).select2('destroy');
    }
  });
  if(form.length){
    form.validate().resetForm();
  }
  form.find('[name=webhookName]').val('').removeClass('error');
  form.find('[name=webhookTrigger]').val('').removeClass('error');
  form.find('[name=webhookType]').val('webhook').removeClass('error');
  form.find('[name=webhookMethod]').val('POST').removeClass('error');
  form.find('[name=webhookUrl]').val('').removeClass('error');
  form.find('[name=webhookHeaders]').val('').removeClass('error');
}

Template.companyWebhooksCreate.onRendered(function () {
  Session.set('webhookType');
  const projectId = this.data && this.data.projectId
  $('#addWebhookForm').validate({
    rules: {
      webhookName: {
        required: true
      },
      webhookTrigger: {
        required: true
      },
      webhookType: {
        required: true
      },
      webhookMethod: {
        required: function() {
          return $(WEBHOOK_TYPE_SELECT).val() === 'webhook';
        }
      },
      webhookUrl: {
        required: function() {
          return $(WEBHOOK_TYPE_SELECT).val() === 'webhook';
        }
      },
      webhookHeaders: {
        required: false
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
      let webhookName = $(form).find('[name=webhookName]').val();
      let webhookTrigger = $(form).find('[name=webhookTrigger]').val();
      let webhookType = $(form).find('[name=webhookType]').val();
      let webhookMethod = $(form).find('[name=webhookMethod]').val();
      let webhookUrl = $(form).find('[name=webhookUrl]').val();
      let webhookHeaders = $(form).find('[name=webhookHeaders]').val();
      if(!webhookTrigger.length){
        Notify.warn('Select webhook trigger first');
        return
      }
      const webhook = {
        name: webhookName,
        triggers: webhookTrigger,
        type: webhookType,
        method: webhookMethod,
        url:webhookUrl,
        projectId,
        headers: webhookHeaders && webhookHeaders.split(';').map(item => {
          let parts = item.split(':')
          if(parts[0] && parts[0].length && parts[1] && parts[1].length){
            return {key:parts[0].trim(), value:parts[1].trim()}
          }
          return undefined
        }).filter(item => !!item)
      };
      Meteor.callAsync('Webhook.Create', webhook).then(function() {
        const message = 'New webhook ' + webhookName + ' created';
        Notify.success(message);
        Meteor.setTimeout(function () {
          $('#createWebhook').modal('hide');
        }, 300);
      }).catch(function(error) {
        const message = 'Internal Error: ' + (error.reason || 'could not create webhook');
        Notify.danger(message);
      });
    }
  });

  $('#createWebhook').off('.companyWebhooksCreate')
    .on('show.bs.modal.companyWebhooksCreate', function () {
      resetForm();
      Meteor.setTimeout(function () {
        $('#createWebhook .select2:not('+WEBHOOK_TYPE_SELECT+')').select2({width: '100%'});
        $(WEBHOOK_TYPE_SELECT).select2({width: '100%'}).on('change.select2', onWebhookTypeChange);
      },1)
    })
    .on('hidden.bs.modal.companyWebhooksCreate', function () {
      resetForm();
    });
});

Template.companyWebhooksCreate.onDestroyed(function () {
  $('#createWebhook').off('.companyWebhooksCreate');
});

Template.companyWebhooksCreate.events({
  'submit #addWebhookForm': function (event) {
    event.preventDefault();
  }
});

Template.companyWebhooksCreate.helpers({
  // Rendered from the shared list so the dialog, and the Triggers column of both
  // webhook list pages, can never disagree about what exists or what it is called.
  webhookTriggerOptions: function () {
    return WEBHOOK_TRIGGERS;
  },
  // Same reason, for the receiver types: this dialog and the Type column of both
  // list pages read one list, so they cannot disagree about what exists.
  webhookTypeOptions: function () {
    return buildWebhookTypeOptions();
  },
  // Blaze rejects a `{{#if}}` in bare attribute position, so a valueless boolean
  // attribute is emitted by a helper returning its name or an empty string.
  disabledAttr: function () {
    return this.disabled ? 'disabled' : '';
  },
  webhookTypeWebhook: function () {
    const type = Session.get('webhookType')
    return !type || type === 'webhook'
  },
  webhookTypeTeams: function () {
    const type = Session.get('webhookType')
    return type === 'teams'
  },
  webhookTypeTeamsWorkflow: function () {
    const type = Session.get('webhookType')
    return type === 'teamsWorkflow'
  },
  webhookTypeSlack: function () {
    const type = Session.get('webhookType')
    return type === 'slack'
  },
  webhookTypeGitter: function () {
    const type = Session.get('webhookType')
    return type === 'gitter'
  }
});
