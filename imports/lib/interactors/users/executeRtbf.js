import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import LogEvents from '/imports/lib/collections/logevents';
import ComponentModifications from '/imports/lib/collections/componentModifications';
import Approves from '/imports/lib/collections/approves';
import Tags from '/imports/lib/collections/tags';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import ManualVulnerabilities from '/imports/lib/collections/manualVulnerabilities';
import RiskProperties from '/imports/lib/collections/riskProperties';
import Tasks from '/imports/lib/collections/tasks';
import SbomFiles from '/imports/lib/collections/sbomFiles';
import Webhooks from '/imports/lib/collections/webhooks';
import Capabilities from '/imports/lib/collections/capabilities';
import CweMappings from '/imports/lib/collections/cweMappings';

// Every collection that keeps the name of the user next to their id, and the field
// that holds the id. The name is replaced with the RTBF text.
const USER_NAME_COLLECTIONS = [
  [LogEvents, 'userId'],
  [ComponentModifications, 'userId'],
  [Approves, 'userId'],
  [Tags, 'userId'],
  [NoticeFiles, 'userId'],
  [ManualVulnerabilities, 'userId'],
  [RiskProperties, 'userId'],
  [Tasks, 'userId'],
  [SbomFiles, 'userId'],
  [Webhooks, 'userId'],
  [Capabilities, 'userId'],
  [CweMappings, 'createdBy']
];

const executeRtbf = async function (userId, companyId, params) {
  const user = await Meteor.userAsync();
  if (!user || companyId !== user.profile.companyId ||
    !await Roles.userIsInRole(user._id, ['account_admin'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const numOr0 = n => isNaN(n) ? 0 : n;
  let total = 0;
  for (const [collection, idField] of USER_NAME_COLLECTIONS) {
    // multi: every document of the user, not only the first one per collection. The
    // schema is bypassed: only the name changes, and some documents predate fields
    // their schema now requires.
    total += numOr0(await collection.updateAsync({[idField]: userId, companyId},
      {$set: {userName: params.rtbf}}, {multi: true, bypassCollection2: true}));
  }
  await Meteor.callAsync('logEvent', user, 'The right to be forgotten was applied for '+ total +' documents', 'userUpdate');
  return total
};

export default executeRtbf;
