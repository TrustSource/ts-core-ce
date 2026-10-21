import {Meteor} from 'meteor/meteor';
import {WebhookCreate, WebhookRemove, WebhookRevealSecret} from '/imports/lib/interactors/webhooks'

Meteor.methods({
  'Webhook.Create': WebhookCreate,
  'Webhook.Remove': WebhookRemove,
  'Webhook.RevealSecret': WebhookRevealSecret
});
