import {Meteor} from 'meteor/meteor';
import {PolicyRemove, PolicyUpdateNotified} from '/imports/lib/interactors/policy'

Meteor.methods({
  'Policy.Remove': PolicyRemove,
  'Policy.UpdateNotified': PolicyUpdateNotified
});
