import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Modules from '/imports/lib/collections/modules';

Meteor.methods({
  'Analysis.AssignTag': async function ({tagName, moduleId, analysisId}) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    if (!user || !await Roles.userIsInRole(user._id, ['account_admin', 'manager', 'developer', 'compliance_manager'], companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    const now = new Date();
    let module = await Modules.findOneAsync(moduleId);
    if (!module || module.companyId !== companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    let analysis = analysisId ||
      (module && module.analysis && module.analysis[0] && module.analysis[0]._id)
    let release = {
      name: tagName,
      date: now
    };
    let action = { $push: {'release':  release}};
    if (!module.release || (module.release && module.release.name)){
      let list = [];
      list.push(release);
      action = { $set: {'release':  list}};
    }
    try{
      let updatedModule = await Modules.updateAsync(module._id, action);
      if(updatedModule){
        await Meteor.callAsync('updateLastAnalysis', module._id, release, analysis);
        const message = 'New name ' + release.name + ' assigned to analysis';
        await Meteor.callAsync('logEvent', user, 'Module '+module.name+': ' + message, 'nameAnalysis');
      }
      return updatedModule
    }
    catch (e) {
      console.info('=> AnalysisAssignName: ', e);
      let text = 'Error: ' + ((e && e.reason) || ' problem on analysis naming');
      await Meteor.callAsync('logEvent', user, text, 'nameAnalysis');
      throw new Meteor.Error(e.error, text);
    }
  }
});
