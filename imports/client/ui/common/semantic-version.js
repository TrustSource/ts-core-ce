import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';

Template.semanticVersion.helpers({
  versionsObject: function () {
    let versionData = (Session.get('semanticVersionUpdate') || this.document && this.document.version);
    if (!versionData) return false;
    let version = versionData.split('.')
    if(version){
      return [
        {
          version: version[0],
          type: 'major',
          item: 0
        },{
          version: version[1],
          type: 'minor',
          item: 1
        },{
          version: version[2],
          type: 'patch',
          item: 2
        }
      ]
    }
    return false
  }
});

Template.semanticVersion.events({
  'click .inc_version': function (event) {
    event.preventDefault();
    const templateData = Template.currentData();
    let versionData = (Session.get('semanticVersionUpdate') || templateData.document && templateData.document.version);
    let version = versionData.split('.');
    version[this.item] = parseInt(version[this.item])+1;
    if(this.item === 0){
      version[1] = 0;
    }
    if(this.item === 1 || this.item === 0){
      version[2] = 0;
    }
    Session.set('semanticVersionUpdate',version.join('.'))
  },
  'click .dec_version': function (event) {
    event.preventDefault();
    const templateData = Template.currentData();
    let versionData = (Session.get('semanticVersionUpdate') || templateData.document && templateData.document.version);
    let version = versionData.split('.');
    version[this.item] = parseInt(version[this.item]) === 0 ? 0 : parseInt(version[this.item])-1;
    Session.set('semanticVersionUpdate',version.join('.'))
  }
});
