import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Spacebars} from 'meteor/spacebars';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import MessagesFolders from '/imports/lib/interactors/messages/folders';
import {MESSAGE_LABELS, messageLabels} from '/imports/lib/interactors/messages/labels';


Template.messages.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.messages.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.messages.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button, .col-marked, .col-trash').length) return;
    Meteor.callAsync('Messages.ChangeViewed',{messageId:this._id});
  },
  'click .move-to-marked': function () {
     
    Meteor.callAsync('Messages.MoveToFolder',{messageId:this._id,newFolder:'marked'})
  },
  'click .move-to-inbox': function () {
     
    Meteor.callAsync('Messages.MoveToFolder',{messageId:this._id,newFolder:'inbox'})
  },
  'click .move-to-trash': function () {
     
    Meteor.callAsync('Messages.MoveToFolder',{messageId:this._id,newFolder:'trash'})
  },
  'click .empty-trash-now': function () {
    Meteor.callAsync('Messages.EmptyTrashFolder').then(function() {
      Notify.success('Trash messages have been deleted!');
    })
  },
  'click .active .filter-action': function (event) {
    event.preventDefault();
    let query = Router.current().params.query;
    if (query.type === this.value) {
      let newUrl = Router.current().route.path(Router.current().params);
      Router.go(newUrl);
    }
  }
});

Template.messages.helpers({

  messages: function () {
    return this;
  },

  reactiveTableSettings: function () {
    return {
      collection: this,
      class: 'table table-hover col-sm-12',
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableMessagesNoData,
      rowClass: function(item) {
        return (item.viewed)?'':'unread'
      },
      fields: [
        {
          fieldId: 'marked',
          key: 'marked',
          label: '',
          tmpl: Template.reactiveTableMessagesMarked,
          cellClass: 'col-marked'
        },
        {
          fieldId: 'senderId',
          key: 'senderId',
          label: 'From',
          fn: function (value,object) {
            return object.senderName;
          },
          cellClass: 'col-sender'
        },
        {
          fieldId: 'type',
          key: 'type',
          label: '',
          fn: function (value) {
            let label = _.find(MESSAGE_LABELS,function (label) {
              return label.value === value
            });
            const labelColor = label ? label.color : 'default';
            const labelIcon = label ? label.icon : 'fa-info-circle';
            return (value) ? new Spacebars.SafeString('<span class="square-20 label-'+escapeHtml(labelColor)+
              '" title="'+ escapeHtml(label && label.label || '') + '"><span class=" fa '+escapeHtml(labelIcon)+
              '"></span></span>') : '';
          },
          cellClass: 'col-type'
        },
        {
          fieldId: 'message',
          key: 'message',
          label: 'Message',
          sortable: false,
          tmpl: Template.reactiveTableMessagesMessage
        },
        {
          fieldId: 'created',
          key: 'created',
          label: 'Date',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'remove',
          key: 'remove',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableMessagesTrash,
          cellClass: 'col-trash'
        }
      ]
    };
  },

  messagesFolders: function () {
    return MessagesFolders()
  },

  // Synchronous on the client: the labels function used to be async, so these
  // helpers got a Promise and the type filters never showed.
  messagesLabels: function () {
    return messageLabels()
  },

  activeFolder: function () {
    return Router.current().url.indexOf(this.value) > -1
  },

  activeTrash: function () {
    return Router.current().url.indexOf('trash') > -1
  },

  haveNoMessages: function () {
    return !this || this.length === 0
  },

  currentFolder: function () {
    return Router.current().params.folder
  },

  getQuery: function () {
    let label = this.value;
    return label ? {type:label}:null
  },

  activeFilter: function () {
    return Router.current().url.indexOf(this.value) > -1
  },

  hasTypes: function () {
    return _.any(messageLabels(),function (item) {
      return item.available
    })
  }

});

Template.reactiveTableMessagesMessage.helpers({
  actionRoute: function () {
    const message = this;
    let route = {};
    switch (message.type) {
    case 'changeComponentStatus':
      route.route = 'moduleDependencies';
      route.params = {
        projectId: message.projectId || Projects.UNASSIGNED,
        moduleId: message.moduleId
      };
      route.query = {
        filter: message.componentKey
      };
      break;
      // eslint-disable-next-line sonarjs/no-duplicated-branches
    case 'resetComponentStatus':
      route.route = 'moduleDependencies';
      route.params = {
        projectId: message.projectId || Projects.UNASSIGNED,
        moduleId: message.moduleId
      };
      route.query = {
        filter: message.componentKey
      };
      break;
      // eslint-disable-next-line sonarjs/no-duplicated-branches
    case 'componentComment':
      route.route = 'moduleDependencies';
      route.params = {
        projectId: message.projectId || Projects.UNASSIGNED,
        moduleId: message.moduleId
      };
      route.query = {
        filter: message.componentKey
      };
      break;
       
    case 'vulnerabilityIntroduced':
      route.route = 'moduleDependencies';
      route.params = {
        projectId: message.projectId || Projects.UNASSIGNED,
        moduleId: message.moduleId
      };
      if(message.componentKey){
        route.query = {
          filter: message.componentKey
        };
      }
      break;
    case 'eventsApprovals':
      if(message.approveId) {
        route.route = 'approvesDetails';
        route.params = {
          approveId: message.approveId
        };
        break;
      }else if(message.moduleId){
        route.route = 'reportObligations';
        route.query = {
          projectId: message.projectId,
          moduleId: message.moduleId
        };
        break;
      } else if (message.projectId){
        route.route = 'reportObligations';
        route.query = {
          projectId: message.projectId
        };
      }
      break;
    default:
      if(message.componentKey && message.moduleId){
        route.route = 'moduleDependencies';
        route.params = {
          projectId: message.projectId || Projects.UNASSIGNED,
          moduleId: message.moduleId
        };
        route.query = {
          filter: message.componentKey
        };
        break;
      }
      if(message.moduleId){
        route.route = 'moduleDependencies';
        route.params = {
          projectId: message.projectId || Projects.UNASSIGNED,
          moduleId: message.moduleId
        };
        break;
      }else if (message.projectId){
        route.route = 'projectModules';
        route.params = {
          projectId: message.projectId || Projects.UNASSIGNED
        };
      }
    }
    return route
  }

});

Template.reactiveTableMessagesMarked.helpers({
  isMarked: function () {
    return this.folder === 'marked';
  }
});
