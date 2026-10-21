import {Mongo} from 'meteor/mongo';
import Message from '/imports/lib/models/message';

const Messages = new Mongo.Collection('messages', {
  transform: function (doc) {
    return new Message(doc);
  }
});

export default Messages;
