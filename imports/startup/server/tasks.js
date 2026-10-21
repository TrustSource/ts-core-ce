import {Meteor} from 'meteor/meteor';
import {TasksCreate, TasksRemove, TasksUpdate, TasksFind, TasksFindByRisks, TasksFindOne} from '/imports/lib/interactors/tasks'

Meteor.methods({
  'Tasks.Create': async function (...args) { return await TasksCreate.apply(this, args); },
  'Tasks.Update': async function (...args) { return await TasksUpdate.apply(this, args); },
  'Tasks.Remove': async function (...args) { return await TasksRemove.apply(this, args); },
  'Tasks.Find': async function (...args) { return await TasksFind.apply(this, args); },
  'Tasks.FindOne': async function (...args) { return await TasksFindOne.apply(this, args); },
  'Tasks.FindByRisks': async function (...args) { return await TasksFindByRisks.apply(this, args); }
});
