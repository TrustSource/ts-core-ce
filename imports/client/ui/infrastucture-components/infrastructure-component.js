import {Meteor} from 'meteor/meteor';
import {idParam} from '/imports/lib/mongoId';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Spacebars} from 'meteor/spacebars';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';
import {moment} from 'meteor/momentjs:moment';
import {$} from 'meteor/jquery';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import InfrastructureComponent from '/imports/lib/component/InfrastructureComponent';
import Company from '/imports/lib/company/Company';

let nextComponentCountUpdate;
Session.set('infrastructureComponentCount');

Template.infrastructureComponentsList.onCreated(function () {
  const data = Session.get('infrastructureComponentCount');
  if (!data) {
    Meteor.callAsync('countInfrastructureComponents').then(function(data) {
      if (data !== undefined) {
        Session.set('infrastructureComponentCount', data);
        nextComponentCountUpdate = moment().add(30, 'seconds').toDate();
      }
    });
  }
});

Template.infrastructureComponentsList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.infrastructureComponentsList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.infrastructureComponentsList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      // _id is a Mongo.ObjectID here; stringified straight it becomes ObjectID("...").
      Router.go('infrastructureComponentDetails', {_id: idParam(this._id)});
    }
  }
});

// Catalog links are rendered into raw HTML: only an http(s) URL becomes a link, escaped,
// so a stored `javascript:` URL or a quote cannot run script in the list.
function safeLink(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? escapeHtml(url.trim()) : '';
}

function getInfrastructureComponents() {
  let type = 'infrastructureСomponents'
  let params = {name: Session.get('componentListFilter')}
  let extendedFilter = Session.get('filterSettings' + type)
  if(extendedFilter){
    params = JSON.parse(extendedFilter)
  }
  let extendedSorting = Session.get('sortingSettings' + type)
  if(extendedSorting){
    extendedSorting = JSON.parse(extendedSorting)
  }
  // The revision only changes the call's cache key, so a component created on this page
  // refetches the list; the method ignores it.
  const revision = Session.get('infrastructureComponentsRevision') || 0;
  let raw = ReactiveMethod.call('searchInfrastructureComponentsByFields',params, extendedSorting, revision);
  return raw === undefined ? null : (raw || []);
}

Template.infrastructureComponentsList.helpers({

  isLoading: function () {
    return getInfrastructureComponents() === null;
  },

  countComponents: function () {
    if (nextComponentCountUpdate && new Date() > nextComponentCountUpdate) {
      Session.set('infrastructureComponentCount');
    }
    const count = Session.get('infrastructureComponentCount');
    return count || '';
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  reactiveTableSettings: function () {
    const company = Session.get('company');
    const companyClass = new Company(company);
    return {
      collection: getInfrastructureComponents() || [],
      rowsPerPage: 15,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          sortable: false,
          fn: function (value, object) {
            const comp = new InfrastructureComponent(object);
            const name = comp.getName() || object._id;
            let badge = '';
            if (companyClass.isComponentBlacklisted(comp.getKey(), '*')) {
              badge = '<span class="label label-danger m-r-xs" title="Blacklisted">B</span>';
            }
            let category = '';
            if (comp.getCategory()) {
              category = '<br><small class="text-muted"><span class="fa fa-tags"></span> ' + escapeHtml(comp.getCategoryString()) + '</small>';
            }
            return new Spacebars.SafeString(badge + '<span class="truncate max-w-400px">' + escapeHtml(name) + '</span>' + category);
          }
        },
        {
          fieldId: 'description',
          key: 'description',
          label: 'Description',
          sortable: false,
          fn: function (value, object) {
            const comp = new InfrastructureComponent(object);
            let desc = comp.getDescription() || object.shortDescription || '';
            if (desc.length > 100) desc = desc.substring(0, 100) + '...';
            return desc;
          }
        },
        {
          fieldId: 'links',
          key: 'urls',
          label: 'Links',
          sortable: false,
          fn: function (value, object) {
            const comp = new InfrastructureComponent(object);
            let html = '';
            const homepage = safeLink(comp.getUrl('homepage'));
            const repo = safeLink(comp.getUrl('repository'));
            if (homepage) html += '<a href="' + homepage + '" target="_blank" rel="noopener noreferrer" title="Homepage"><i class="fa fa-fw fa-home"></i></a>';
            if (repo) html += '<a href="' + repo + '" target="_blank" rel="noopener noreferrer" title="Repository"><i class="fa fa-fw fa-code-fork"></i></a>';
            return new Spacebars.SafeString(html);
          },
          cellClass: 'col-100'
        }
      ]
    };
  }
});
