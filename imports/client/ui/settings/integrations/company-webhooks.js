import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import Notify from '/imports/api/notify';
import {webhookTriggersLabel, webhookTypeLabel} from '/imports/lib/company/webhookTriggers';
import {copyRevealedKey} from '/imports/client/ui/common/reveal-copy';

Template.companyWebhooks.helpers({
  reactiveTableSettings: function () {
    return {
      collection: this,
      rowsPerPage: 15,
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
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name'
        },
        {
          fieldId: 'type',
          key: 'type',
          // The shared label map, not toTitleCase: that helper lower-cases the
          // remainder of each word, so the shipped `teamsWorkflow` type rendered
          // as 'Teamsworkflow'. The dialog's <option> list reads the same map.
          label: 'Type',
          fn: function (value) {
            return webhookTypeLabel(value);
          }
        },
        {
          fieldId: 'triggers',
          key: 'triggers',
          label: 'Triggers',
          // The shared label map, not toTitleCase: that helper lower-cases the
          // remainder of each word, so `vulnerabilitiesByModule` rendered as
          // 'Vulnerabilitiesbymodule'. The Add-webhook dialog's option labels
          // and the project settings column read the same map.
          fn: function (value) {
            return value && webhookTriggersLabel(value);
          }
        },
        {
          fieldId: 'url',
          key: 'urlDisplay',
          label: 'URL',
          // A TEMPLATE, not a Spacebars.SafeString built by hand. The url is
          // attacker-controllable (anyone who may create a webhook writes it,
          // and it is arbitrary text on the paths that skip the interactor), and
          // SafeString explicitly turns Blaze's escaping OFF - so a stored url
          // carrying a quote and a tag executed for every colleague who opened
          // this page. Blaze escapes both the body and the title attribute here.
          tmpl: Template.reactiveTableWebhookUrlCell
        },
        {
          fieldId: 'method',
          key: 'method',
          label: 'Method'
        },
        {
          fieldId: 'headers',
          key: 'headers',
          label: 'Headers',
          // Same treatment. The previous cell stripped `"` out of the serialised
          // headers to keep them inside a hand-built title attribute, which is a
          // guess about HTML parsing rather than escaping.
          tmpl: Template.reactiveTableWebhookHeadersCell,
          // The old cell sorted on its own markup, whose leading `sort="<count>"`
          // made the count the effective key. Say so instead of relying on it.
          sortFn: function (value) {
            return (value || []).length;
          }
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableWebhooksActions,
          cellClass: 'col-actions'
        }
      ]
    };
  }
});

Template.reactiveTableWebhooksActions.events({
  'click .copy-webhook-secret': function (event) {
    event.preventDefault();
    copyRevealedKey('Webhook.RevealSecret', this._id);
  },
  'click .remove': function (event) {
    event.preventDefault();
    const {name} = this;
    Meteor.callAsync('Webhook.Remove', this._id).then(function() {
      const message = 'Webhook '+name+' removed';
      Notify.success(message);
    }).catch(function(error) {
      const message = 'Internal Error: ' + (error.reason || 'could not remove webhook');
      Notify.danger(message);
    })
  }
});

// Both cells are shared with the project settings webhooks list.
Template.reactiveTableWebhookHeadersCell.helpers({
  headerList: function () {
    return this.headers || [];
  },
  // Header values are credentials and never reach the browser; only the names do.
  headersTitle: function () {
    return (this.headers || []).map((header) => header.key).join('\n');
  }
});
