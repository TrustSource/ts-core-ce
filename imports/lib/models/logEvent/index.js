import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import Modules from '/imports/lib/collections/modules'
import Projects from '/imports/lib/collections/projects';

const LogEvent = function LogEvent(doc) {
  _.extend(this, doc);

  this.user = function () {
    return this.userId && Meteor.users.findOne(this.userId);
  };

  this.project = function () {
    return this.projectId && Projects.findOne(this.projectId);
  };

  this.module = function () {
    return this.moduleId && Modules.findOne(this.moduleId);
  };
};

LogEvent.prototype.getDate = function () {
  return this.created;
};

// How the NAME column of an audit-log table renders a row.
//
// `userName` is written by logEvent.js via userDisplayName(), which falls back to the account
// address for the many users who have no profile.name - so "name (account)" printed the same
// address twice. Pair them only when the name adds something. Takes a plain document, because
// the server-side reactive tables that show these rows never get the collection transform.
export function logEventUserLabel(logEvent) {
  const name = logEvent && logEvent.userName;
  const account = logEvent && logEvent.account;
  if (!account) { return name || ''; }
  return name && name !== account ? name + ' (' + account + ')' : account;
}

export default LogEvent;
