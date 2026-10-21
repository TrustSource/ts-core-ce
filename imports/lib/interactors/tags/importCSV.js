import {Meteor} from 'meteor/meteor';
import Tags from '/imports/lib/collections/tags';
import _ from 'underscore';
import create from './create';

const importCSV = async function (data) {
  let result = [];
  const currentUser = await Meteor.userAsync();
  const companyId = currentUser.profile.companyId
  for ( let i = 0; i < data.length; i++ ) {
    let tag  = data[ i ];
    let name = tag['Name'] || tag['name'];
    if(name.length > 0){
      name = name.trim()
    }
    const description = tag['Description'] || tag['description'];
    if(name && name.length > 0) {
      let checkDuplicates = await Tags.findOneAsync({companyId, name:name, deleted:{$exists: false}})
      if(checkDuplicates){
        result.push({
          status: 'error',
          message: 'Duplicate, tag already exists'
        });
      }else{
        if (/^[a-z0-9:-]+$/.test(name)) {
          try {
            await create({
              name,
              description
            });
            result.push({
              status: 'imported',
              message: `${name} - ${description}`
            });
          } catch (error) {
            result.push({
              status: 'error',
              message: error.reason
            });
          }
        } else {
          let message = 'Please enter valid ';
          let entry = [];
          entry.push('Name')
          result.push({
            status: 'error',
            message: message + entry.join(' and ')
          });
        }
      }
    }else {
      let message = 'Please enter ';
      let entry = [];
      entry.push('Name')
      result.push({
        status: 'error',
        message: message + entry.join(' and ')
      });
    }
  }
  let stats = _.countBy(result,function (item) {
    return item.status
  });
  return {
    result: result,
    stats: stats
  }
};

export default importCSV;
