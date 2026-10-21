import {Meteor} from 'meteor/meteor';
import Messages from '/imports/lib/collections/messages';

const moveToFolder = async function ({messageId,newFolder}) {
  const user = await Meteor.userAsync();
  const now = new Date();
  const message = await Messages.findOneAsync(messageId);
  if(message && message.userId === user._id){
    await Messages.updateAsync({ _id : messageId }, { $set: { folder : newFolder , updated:now} });
  }
};

export default moveToFolder;
