import {Meteor} from 'meteor/meteor';
import Messages from '/imports/lib/collections/messages';

const emptyTrashFolder = async function () {
  const user = await Meteor.userAsync();
  if(user){
    await Messages.removeAsync({userId:user._id, folder : 'trash' });
  }
};

export default emptyTrashFolder;
