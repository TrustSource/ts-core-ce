import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import ComponentModifications from '/imports/lib/collections/componentModifications';

 
const createChangesList = async function (params, callback) {
  let componentObject = {
    key: params.component.key,
    version: params.component.version,
    paths: params.component.paths
  };
  const user = await Meteor.userAsync();
  let componentModificationList = [];
  for (const [key, value] of Object.entries(params.updates)) {
    let type = key;
    let newValue = value;
    if(params.component[key] !== value && value){
      if(params.component && params.component.moduleIds){
        for (const moduleId of params.component.moduleIds) {
          let doc = {
            created: new Date(),
            companyId: user.profile.companyId,
            moduleId: moduleId,
            userId: user._id,
            userName: ((user.profile && user.profile.name) ||
              (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
            private: true,
            component: componentObject,
            type: type,
            value: newValue
          };
          let request = await ComponentModifications.insertAsync(doc);
          componentModificationList.push(request);
        }
      }else if (params.moduleId){
        let doc = {
          created: new Date(),
          companyId: user.profile.companyId,
          moduleId: params.moduleId,
          userId: user._id,
          userName: ((user.profile && user.profile.name) ||
            (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
          private: true,
          component: componentObject,
          type: type,
          value: newValue
        };
        let request = await ComponentModifications.insertAsync(doc);
        const purposeOrSettings = type === 'purpose' ? 'Purpose' : 'Settings';
        const urlOrOther = type === 'changesUrl' ? 'Changes url' : purposeOrSettings;
        const logType = type === 'changesText' ? 'Modification notice' : urlOrOther
        await Meteor.callAsync('logEvent', user, logType +' for component '+ componentObject.key +' was changed to "'+newValue+'" '
          + (params.moduleName? 'In module '+ params.moduleName: ''), 'componentUpdated');
        componentModificationList.push(request);
      }else if (params.projectId){
        let doc = {
          created: new Date(),
          companyId: user.profile.companyId,
          projectId: params.projectId,
          userId: user._id,
          userName: ((user.profile && user.profile.name) ||
            (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
          private: true,
          component: componentObject,
          type: type,
          value: newValue
        };
        let request = await ComponentModifications.insertAsync(doc);
        const logType = 'Settings'
        await Meteor.callAsync('logEvent', user, logType +' for component '+ componentObject.key +' was changed to "'+newValue+'" '
          + (params.projectName? 'In project '+ params.projectName: ''), 'componentUpdated');
        componentModificationList.push(request);
      }
    }
  }
  if(callback && _.isFunction(callback)){
    callback()
  }
  if(componentModificationList){
    return componentModificationList.length
  }else{
    return false
  }
};

export default createChangesList;
