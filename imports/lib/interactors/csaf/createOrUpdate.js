import {Meteor} from 'meteor/meteor';
import create from './create';
import update from './update';

const createOrUpdate = async function (modifier, _id, apiUser) {
  const user = await Meteor.userAsync();
  if(!_id){
    const companyId = user && user.profile && user.profile.companyId;
    const file = JSON.parse(modifier['$set'].data)
    const name = file.document.title
    return await create({file, companyId, name, apiUser: apiUser || user})
  }else{
    return await update(modifier, _id, apiUser || user)
  }
};

export default createOrUpdate;
