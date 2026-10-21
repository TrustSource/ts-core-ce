import {Mongo} from 'meteor/mongo';
import Webhook from '/imports/lib/company/Webhook';
import {WebhookSchema} from '/imports/lib/schemas/webhookSchema';

const Webhooks = new Mongo.Collection('webhooks', {
  transform: function (doc) {
    return new Webhook(doc);
  }
});

Webhooks.attachSchema(WebhookSchema);

export default Webhooks;

