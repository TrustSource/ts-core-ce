import { Template } from 'meteor/templating';
import { Session } from 'meteor/session';

Template.checkList.helpers({
  isChecked() {
    const { itemId, listVariable } = Template.currentData();
    const checkedItems = Session.get(listVariable) || [];
    return checkedItems.includes(itemId);
  }
});

Template.checkList.events({
  'change .check_list_item'(event, instance) {
    const { itemId, listVariable } = instance.data;
    const checkedItems = Session.get(listVariable) || [];
    if (event.target.checked) {
      if (!checkedItems.includes(itemId)) {
        Session.set(listVariable, [...checkedItems, itemId]);
      }
    } else {
      Session.set(listVariable, checkedItems.filter(id => id !== itemId));
    }
  }
});
