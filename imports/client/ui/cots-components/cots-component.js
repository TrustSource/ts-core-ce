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
import COTSComponent from '/imports/lib/component/COTSComponent';
import Company from '/imports/lib/company/Company';

let nextComponentCountUpdate;
Session.set('cotsComponentCount');

Template.cotsComponentsList.onCreated(function () {
  const data = Session.get('cotsComponentCount');
  if (!data) {
    Meteor.callAsync('countCotsComponents').then(function(data) {
      if (data !== undefined) {
        Session.set('cotsComponentCount', data);
        nextComponentCountUpdate = moment().add(30, 'seconds').toDate();
      }
    });
  }
});

Template.cotsComponentsList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.cotsComponentsList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.cotsComponentsList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      // _id is a Mongo.ObjectID here; stringified straight it becomes ObjectID("...").
      Router.go('cotsComponentDetails', {_id: idParam(this._id)});
    }
  }
});

function getCotsComponents() {
  let type = 'cotsСomponents'
  let params = {name: Session.get('componentListFilter')}
  let extendedFilter = Session.get('filterSettings' + type)
  if(extendedFilter){
    params = JSON.parse(extendedFilter)
  }
  let extendedSorting = Session.get('sortingSettings' + type)
  if(extendedSorting){
    extendedSorting = JSON.parse(extendedSorting)
  }
  let raw = ReactiveMethod.call('searchCotsComponentsByFields',params, extendedSorting);
  return raw === undefined ? null : (raw || []);
}

Template.cotsComponentsList.helpers({

  isLoading: function () {
    return getCotsComponents() === null;
  },

  countComponents: function () {
    if (nextComponentCountUpdate && new Date() > nextComponentCountUpdate) {
      Session.set('cotsComponentCount');
    }
    const count = Session.get('cotsComponentCount');
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
      collection: getCotsComponents() || [],
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
            const comp = new COTSComponent(object);
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
            const comp = new COTSComponent(object);
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
            const comp = new COTSComponent(object);
            let html = '';
            const homepage = comp.getUrl('homepage');
            const repo = comp.getUrl('repository');
            if (homepage) html += '<a href="' + homepage + '" target="_blank" title="Homepage"><i class="fa fa-fw fa-home"></i></a>';
            if (repo) html += '<a href="' + repo + '" target="_blank" title="Repository"><i class="fa fa-fw fa-code-fork"></i></a>';
            return new Spacebars.SafeString(html);
          },
          cellClass: 'col-100'
        }
      ]
    };
  }
});
