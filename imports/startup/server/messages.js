import {Meteor} from 'meteor/meteor';
import {MessagesCreate, MessagesFind, MessagesAnyNew, MessagesChangeViewed,MessagesFolders,
  MessagesMoveToFolder,MessagesEmptyTrashFolder, MessagesLabels} from '/imports/lib/interactors/messages'

Meteor.methods({
  'Messages.Create': MessagesCreate,
  'Messages.Find': MessagesFind,
  'Messages.AnyNew': MessagesAnyNew,
  'Messages.ChangeViewed': MessagesChangeViewed,
  'Messages.Folders': MessagesFolders,
  'Messages.MoveToFolder': MessagesMoveToFolder,
  'Messages.EmptyTrashFolder': MessagesEmptyTrashFolder,
  'Messages.Labels': MessagesLabels
});