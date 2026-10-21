import {Meteor} from 'meteor/meteor';
import {UpdatesView} from '/imports/lib/interactors/updates'

Meteor.methods({
  'Updates.View': async function (_id, filter) {
    return await UpdatesView(_id, filter);
  }
});
