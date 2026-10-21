import Messages from '/imports/lib/collections/messages';

// The message types and how the inbox shows them.
export const MESSAGE_LABELS = [
  {label: 'Events', value: 'eventsNotifications', shortLabel: 'Events', color: 'default', icon: 'fa-bell-o'},
  {label: 'Approvals', value: 'eventsApprovals', shortLabel: 'Approvals', color: 'default', icon: 'fa-check-square-o'},
  {label: 'Change component status', value: 'changeComponentStatus', shortLabel: 'Status', color: 'default', icon: 'fa-info-circle'},
  {label: 'Reset component status', value: 'resetComponentStatus', shortLabel: 'Reset', color: 'default', icon: 'fa-undo'},
  {label: 'New vulnerability introduced', value: 'vulnerabilityIntroduced', shortLabel: 'Vulnerability', color: 'default', icon: 'fa-shield-halved'},
  {label: 'Component comment', value: 'componentComment', shortLabel: 'Comment', color: 'default', icon: 'fa-comment'},
  {label: 'Alarms', value: 'alarmsNotifications', shortLabel: 'Alarms', color: 'default', icon: 'fa-exclamation-triangle'},
  {label: 'News', value: 'newsNotifications', shortLabel: 'News', color: 'default', icon: 'fa-newspaper-o'}
];

/**
 * The labels with `available` set for the types present in the inbox. On the
 * client the published messages are counted reactively (Minimongo); the server
 * method (Messages.Labels) uses the async count.
 */
export function messageLabels() {
  return MESSAGE_LABELS.map(function (item) {
    return Object.assign({}, item, {available: Messages.find({type: item.value}).count() > 0});
  });
}

const labels = async function () {
  const result = [];
  for (const item of MESSAGE_LABELS) {
    result.push(Object.assign({}, item, {available: await Messages.find({type: item.value}).countAsync() > 0}));
  }
  return result;
};

export default labels;
