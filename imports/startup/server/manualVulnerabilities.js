import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import ManualVulnerabilities from '/imports/lib/collections/manualVulnerabilities';
import Utils from '/imports/lib/utils';
import {Config} from '/imports/config';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';
import {MANUAL_VULNERABILITY_ROLES} from '/imports/lib/company/settingsAccess';

const componentKeyOpts = {mgr: true, component: true};
const ACCESS_DENIED = 'Access Denied';

Meteor.methods({
  'ManualVulnerabilities.Create': async function ({key, severity, score, link, description, component}) {
    let user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user._id, MANUAL_VULNERABILITY_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    const companyId = user.profile.companyId;
    const componentKey = new Utils.ComponentKey(component.key, componentKeyOpts);
    const vulnerableSoftware = [
      {
        'edition' : null,
        'name' : 'cpe:/a:'+componentKey.component+':'+ component.version,
        'previousVersion' : null,
        'revision' : null,
        'version' : component.version,
        'vendor' : componentKey.component.split(':')[0] || componentKey.mgr,
        'documentId' : componentKey.component,
        'product' : componentKey.component.split(':')[1] || componentKey.component.split(':')[0],
        'searchScore' : 0.0
      }
    ];
    let cvssScore = score;
    if (!cvssScore && severity) {
      if(severity === 'critical'){
        cvssScore = 10
      }else if(severity === 'high'){
        cvssScore = 7
      }else if(severity === 'moderate'){
        cvssScore = 4
      }else if(severity === 'low'){
        cvssScore = 1
      }
    }
    let doc = {
      created: new Date(),
      companyId: companyId,
      userId: user._id,
      userName: Utils.username(user),
      fileName: component.name || component.key,
      description: component.description,
      vuln: {
        key,
        cvssScore: parseFloat(cvssScore),
        name: key,
        severity,
        description,
        link,
        manual: true,
        vulnerableSoftware
      },
      ecs: {
        'confidence' : 'HIGH',
        'description' : null,
        'type' : 'ecs',
        'url' : Config.appUrl,
        'value' : component.key + ':' + component.version
      },
      private: true
    };
    let approveId = await ManualVulnerabilities.insertAsync(doc);
    if(approveId){
      await Meteor.callAsync('logEvent', user, 'Manual vulnerability ' + key, 'ManualVulnerabilitiesCreate');
    }
    return approveId
  },

  'ManualVulnerabilities.Update': async function (modifier, _id, filter) {
    let user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user._id, MANUAL_VULNERABILITY_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    modifier = sanitizeModifier(modifier);
    if(!modifier['$set']){
      modifier['$set']= {};
    }
    modifier['$set'].edited = new Date();
    modifier['$set'].userId = user._id;
    modifier['$set'].userName = Utils.username(user);
    if (!filter && typeof _id !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    const query = filter ? stripDangerousOperators(filter) : {_id};
    query.companyId = user.profile.companyId
    let approveId = await ManualVulnerabilities.updateAsync(query, modifier);
    if(approveId){
      await Meteor.callAsync('logEvent', user, 'Manual vulnerability updated', 'manualVulnerabilitiesUpdated');
    }
    return approveId
  },

  'ManualVulnerabilities.Remove': async function (_id) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user._id, MANUAL_VULNERABILITY_ROLES, user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    if (typeof _id !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    let approveId = await ManualVulnerabilities.removeAsync({_id, companyId: user.profile.companyId});
    if(approveId){
      await Meteor.callAsync('logEvent', user, 'Manual vulnerability removed', 'manualVulnerabilitiesDeleted');
    }
    return approveId
  }
});
