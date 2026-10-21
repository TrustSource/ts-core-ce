import _ from 'underscore';
import {WebhookSchema} from '/imports/lib/schemas/webhookSchema';

const Webhook = function (doc) {
  _.extend(this, doc);
};

Webhook.prototype.validate = function () {
  const context = WebhookSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

export default Webhook;
