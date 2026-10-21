import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';

const SLOW_THRESHOLD_MS = 20000;

Template.creatingWorkspace.onCreated(function () {
  this.isSlow = new ReactiveVar(false);
  this.slowTimer = setTimeout(() => {
    this.isSlow.set(true);
  }, SLOW_THRESHOLD_MS);
});

Template.creatingWorkspace.onDestroyed(function () {
  if (this.slowTimer) clearTimeout(this.slowTimer);
});

Template.creatingWorkspace.helpers({
  isSlow: function () {
    return Template.instance().isSlow.get();
  }
});
