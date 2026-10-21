import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import {messagesSchema} from '/imports/lib/schemas/messagesSchema';
import Modules from '/imports/lib/collections/modules'
import Projects from '/imports/lib/collections/projects';

const Message = function Message(doc) {
  _.extend(this, doc);

  this.user = function () {
    return this.userId && Meteor.users.findOne(this.userId);
  };

  this.sender = function () {
    return this.senderId && Meteor.users.findOne(this.senderId);
  };

  this.project = function () {
    return this.projectId && Projects.findOne(this.projectId);
  };

  this.module = function () {
    return this.moduleId && Modules.findOne(this.moduleId);
  };
};

Message.prototype.getUserName = function () {
  return this.getSenderName();
};

Message.prototype.getSenderName = function () {
  return this.senderName || 'TrustSource'
};

Message.prototype.getDate = function () {
  return this.created;
};

Message.prototype.validate = function () {
  const context = messagesSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

Message.prototype.isMarked = function () {
  return this.folder === 'marked';
};

Message.prototype.isTrash = function () {
  return this.folder === 'trash';
};

Message.prototype.isUnread = function () {
  return !!this.viewed
};


Message.prototype.getMessageIcon = function () {
  if (this.status){
    if (this.status === 'ok'){
      return 'fa-check'
    }
    if (this.status === 'warnings'){
      return 'fa-exclamation'
    }
    if (this.status === 'violations'){
      return 'fa-times'
    }
    if (this.status === 'whitelisted'){
      return 'fa-flag-checkered'
    }
    if (this.status === 'blacklisted'){
      return 'fa-ban'
    }
  }
  return 'fa-comment'
};

Message.prototype.getMessageClass = function () {
  if (this.status){
    if (this.status === 'ok'){
      return 'bg-ok'
    }
    if (this.status === 'warnings'){
      return 'bg-warnings'
    }
    if (this.status === 'violations'){
      return 'bg-violations'
    }
    if (this.status === 'whitelisted'){
      return 'bg-ok'
    }
    if (this.status === 'blacklisted'){
      return 'bg-violations'
    }
  }
  return 'bg-primary'
};

export default Message;
