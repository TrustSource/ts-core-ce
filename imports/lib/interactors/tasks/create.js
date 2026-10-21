import {Meteor} from 'meteor/meteor';
import Tasks from '/imports/lib/collections/tasks';

const create = async function (params, apiUser) {
  let user = await Meteor.userAsync();
  if (!user) {
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }
  let doc = {
    created: new Date(),
    userId: user._id,
    userName: ((user.profile && user.profile.name)
      || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
    companyId: user.profile.companyId,
    riskId: params.riskId,
    due: params.due,
    frequency: params.frequency,
    task: params.task,
    status: params.status,
    comment: params.comment,
    countermeasure: params.countermeasure,
    responsible: params.responsible
  };
  let result = await Tasks.insertAsync(doc);
  if(result){
    await Meteor.callAsync('logEvent', user, 'Task ' + doc.task + ' created', 'tasksCreate');
    return result
  }else{
    return false
  }
};

export default create;
