import {Meteor} from 'meteor/meteor';
import Licenses from '/imports/lib/collections/licenses';

Meteor.startup(async function () {
  await LicensesService.init()
});

const LicensesService = {
  init: async (listData) => {
    let list = listData;
    if (!list) {
      if (Meteor.isServer) {
        list = await Licenses.find({},{fields: {name: 1, key: 1, aliases: 1, url: 1, text: 1, copyright: 1}}).fetchAsync();
      } else {
        list = Licenses.find({},{fields: {name: 1, key: 1, aliases: 1, url: 1, text: 1, copyright: 1}}).fetch();
      }
    }
    if(list && list.length){
      LicensesService.setList(list)
    }
  },
  list: [],
  setList: (list) => {
    LicensesService.list = list.sort(function (a, b) {
      const left = (a.name && a.name.toLowerCase()) || a.key.toLowerCase()
      const right = (b.name && b.name.toLowerCase()) || b.key.toLowerCase()
      return left.localeCompare(right);
    });
  },
  filter: (q)=>{
    return LicensesService.list.filter((l)=>{
      return (l.name && l.name.toLowerCase() === q.toLowerCase()) || l.key.toLowerCase() === q.toLowerCase() ||
        (l.aliases && l.aliases.indexOf(q) !== -1);
    })
  },
  count: (q)=>{
    return LicensesService.list.filter((l)=>{
      return (l.name && l.name.toLowerCase() === q.toLowerCase()) || l.key.toLowerCase() === q.toLowerCase() ||
        (l.aliases && l.aliases.indexOf(q) !== -1);
    }).length
  },
  find: (q) => {
    return LicensesService.list.find((l)=>{
      return (l.name && l.name.toLowerCase() === q.toLowerCase()) || l.key.toLowerCase() === q.toLowerCase() ||
        (l.aliases && l.aliases.indexOf(q) !== -1);
    })
  }
};

export default LicensesService;
