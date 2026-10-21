import {Meteor} from 'meteor/meteor';
import Messages from '/imports/lib/collections/messages';

const changeViewed = async function ({messageId}) {
  const user = await Meteor.userAsync();
  const now = new Date();
  const message = await Messages.findOneAsync(messageId);
  if(message && message.userId === user._id){
    if(message.viewed){
      await Messages.updateAsync({ _id : messageId }, { $unset: {viewed:''} });
    }else{
      await Messages.updateAsync({ _id : messageId }, { $set: { viewed : now } });
    }
  }
};

export default changeViewed;
