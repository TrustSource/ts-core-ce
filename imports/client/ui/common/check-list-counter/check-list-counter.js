import { Template } from 'meteor/templating';
import { Session } from 'meteor/session';

Template.checkListCounter.helpers({
  listItemsCount() {
    const { listVariable } = Template.currentData();
    const checkedItems = Session.get(listVariable) || [];
    return checkedItems.length;
  }
});

Template.checkListCounter.events({
  'click .clear_list'(event, instance) {
    const { listVariable } = instance.data;
    Session.set(listVariable, [])
  }
});
