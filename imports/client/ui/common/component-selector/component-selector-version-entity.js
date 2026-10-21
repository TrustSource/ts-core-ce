import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';

Template.componentSelectorVersionEntity.events({
  'click .pick_version': function () {
    const component = Session.get('selectComponent')
    component.versions = [this.version]
    component.licenses = this.licenses
    Session.set('customComponent', component);
  }
});

