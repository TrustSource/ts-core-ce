import {Meteor} from 'meteor/meteor';
import Rules from '/imports/lib/collections/rules';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('rules', function () {
  if (!this.userId) { return this.ready(); }
  return Rules.find();
});

Meteor.publish('ruleDetail', function (key) {
  if (typeof key !== 'string') { return this.ready(); }
  if(key){
    return Rules.find({key: key});
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
Rules.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawRules;

Meteor.startup(function () {
  RawRules = Utils.makeRawCollection(Rules);
  RawRules.createIndex('key');
});
