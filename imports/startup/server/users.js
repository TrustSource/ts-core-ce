import {Meteor} from 'meteor/meteor';
import {UsersRemove, UsersExecuteRtbf, UsersSetAccountStatus, UsersReset2fa} from '/imports/lib/interactors/users'

Meteor.methods({
  'Users.Remove': UsersRemove,
  'Users.ExecuteRtbf': UsersExecuteRtbf,
  'Users.SetAccountStatus': UsersSetAccountStatus,
  'Users.Reset2fa': UsersReset2fa
});
