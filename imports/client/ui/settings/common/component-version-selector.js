import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Component from '/imports/lib/component/Component';
import VersionedComponentSearch from '/imports/client/ui/lib/VersionedComponentSearch';


Template.componentVersionSelector.onRendered(function () {
  Session.set('componentListFilter');
  Session.set('customComponent');
  VersionedComponentSearch.search(Session.get('componentListFilter'));
});
Template.componentVersionSelector.events({

  'keyup .component_filter': _.throttle(function (event) {
    let text = $(event.target).val().trim();
    Session.set('componentListFilter', text);
    VersionedComponentSearch.search(text);
  }, 400),

  'click .select_component': function () {
    let licenses = _.map(this.getLicenses(this.component.getDeclaredLicenses()),function (license) {
      return {
        'name':license.getKey()
      }
    });
    Session.set('customComponent',{
      'name' : this.component.getName(),
      'key' : this.component.getKey(),
      'description' : this.component.getDescription(),
      'licenses' : licenses || [],
      'homepageUrl' : this.component.getUrl('homepage') || null,
      'repoUrl' : this.component.getUrl('repository') || null,
      'dependencies' : [],
      'versions' : [this.getVersion()]
    });
  },

  'click .remove_component': function () {
    Session.set('customComponent');
  }
});

Template.componentVersionSelector.helpers({
  components: function () {
    return VersionedComponentSearch.getData({
      docTransform: function (doc) {
        return new Component(doc);
      },
      sort: {isoScore: -1}
    })
  },

  searchSource: function () {
    return VersionedComponentSearch.getCurrentQuery();
  },

  selectedClass: function () {
    let item = {
      key: this.component.getKey(),
      versions: this.getVersion()
    };
    let selected = Session.get('customComponent');
    return selected && selected.key === item.key &&  selected.versions[0] === item.versions ?
      'btn-danger2':'btn-primary';
  },

  selectedText: function () {
    let item = {
      key: this.component.getKey(),
      versions: this.getVersion()
    };
    let selected = Session.get('customComponent');
    return selected && selected.key === item.key &&  selected.versions[0] === item.versions ?
      'Selected':'Select';
  },

  customComponent: function () {
    return Session.get('customComponent')
  }
});
