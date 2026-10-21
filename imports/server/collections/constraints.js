import {Meteor} from 'meteor/meteor';
import Constraints from '/imports/lib/collections/constraints';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('constraints', function () {
  if (!this.userId) { return this.ready(); }
  return Constraints.find();
});

Meteor.publish('constraintDetail', function (key) {
  if (typeof key !== 'string') { return this.ready(); }
  if(key){
    return Constraints.find({key: key});
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
Constraints.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawConstraints;

Meteor.startup(function () {
  RawConstraints = Utils.makeRawCollection(Constraints);
  RawConstraints.createIndex('key');
});
