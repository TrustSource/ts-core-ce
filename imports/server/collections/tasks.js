import {Meteor} from 'meteor/meteor';
import Tasks from '/imports/lib/collections/tasks';
import Utils from '../ServerUtils';

Meteor.publish('tasks', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if(user && user.profile && user.profile.companyId){
    return Tasks.find({companyId: user.profile.companyId});
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
Tasks.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

export let RawTasks;

Meteor.startup(function () {
  RawTasks = Utils.makeRawCollection(Tasks);
  RawTasks.createIndex('task');
  RawTasks.createIndex('companyId');
  RawTasks.createIndex('riskId');
  RawTasks.createIndex('countermeasure');
  RawTasks.createIndex('status');
});


