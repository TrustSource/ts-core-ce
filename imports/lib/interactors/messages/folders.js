import Messages from '/imports/lib/collections/messages';

const folders = async function () {
  return [{
    label:'Inbox',
    value:'inbox',
    icon:'fa-inbox',
    newMessages: await Messages.find({viewed:{ $exists: false},$or:[ {folder:'marked'},
      {folder:''},{folder:'inbox'},{folder:{$exists: false}} ]}).countAsync()
  },{
    label:'Marked',
    value:'marked',
    icon:'fa-flag',
    newMessages: await Messages.find({viewed:{ $exists: false},folder:'marked'}).countAsync()
  },{
    label:'Trash',
    value:'trash',
    icon:'fa-trash',
    newMessages: await Messages.find({viewed:{ $exists: false},folder:'trash'}).countAsync()
  }];
};

export default folders;
