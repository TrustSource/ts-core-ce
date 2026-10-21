import Messages from '/imports/lib/collections/messages';

const anyNew = async function (userId) {
  return await Messages.findOneAsync({userId: userId, viewed:{ $exists: false},$or:[ {folder:'marked'},
    {folder:''},{folder:'inbox'},{folder:{$exists: false}} ]});
};

export default anyNew;
