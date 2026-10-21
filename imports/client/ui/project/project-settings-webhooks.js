import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Webhooks from '/imports/lib/collections/webhooks';
import {webhookTriggersLabel, webhookTypeLabel} from '/imports/lib/company/webhookTriggers';

function currentProjectId() {
  const route = Router.current();
  return (route && route.params && route.params.projectId) || null;
}

Template.projectSettingsWebhooks.helpers({
  reactiveTableSettings: function () {
    return {
      // Scope to THIS project explicitly rather than relying on whatever
      // `webhooksByProjectId` left in the client cache. Router.current() is read
      // defensively: it is null on the first run of this reactive computation,
      // and throwing here would abort the whole settings render.
      collection: Webhooks.find(currentProjectId() ? {projectId: currentProjectId()} : {},
        {sort: {created: -1}}),
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
          label: 'Type',
          // The shared map, not toTitleCase: `teamsWorkflow` rendered as
          // 'Teamsworkflow'.
          fn: function (value) {
            return webhookTypeLabel(value);
          }
        },
        {
          fieldId: 'triggers',
          key: 'triggers',
          label: 'Triggers',
          // The shared map, not toTitleCase: that helper lower-cases the rest of
          // each word, so a camelCase trigger renders "Vulnerabilitiesbymodule".
          fn: function (value) {
            return webhookTriggersLabel(value);
          }
        },
        {
          fieldId: 'url',
          key: 'urlDisplay',
          label: 'URL',
          // Shared with the company list. Blaze escapes the url here; this
          // column never built its own markup, but the two pages should not
          // render the same field two different ways.
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
          // Shared with the company list. The previous cell stripped `"` out of
          // the serialised headers to keep them inside a hand-built title
          // attribute, which is a guess about HTML parsing rather than escaping.
          tmpl: Template.reactiveTableWebhookHeadersCell,
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
  },
  projectId: function () {
    return Router.current().params.projectId
  }
});
