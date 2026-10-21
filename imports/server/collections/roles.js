import {Meteor} from 'meteor/meteor';

// The roles collection is global (not per company) and is seeded on the server.
// Clients never create roles: a client insert would add a role for every tenant.
Meteor.roles.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});
