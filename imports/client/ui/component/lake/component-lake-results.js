import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Spacebars} from 'meteor/spacebars';
import {Blaze} from 'meteor/blaze';
import {$} from 'meteor/jquery';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';
import {normalizeExternalUrl} from '/imports/lib/component/externalUrl';
import Component from '/imports/lib/component/Component';
import Company from '/imports/lib/company/Company';

// Result rows for the components lake search. Rows are Components
// documents with schema-validated `urls`.

function externalLink(url, title, icon) {
  const safe = normalizeExternalUrl(url);
  if (!safe) {
    return '';
  }
  return '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer" ' +
    'title="' + escapeHtml(title) + '"><i class="fa fa-fw ' + icon + '"></i></a>';
}

function nameField(companyClass) {
  return {
    fieldId: 'name',
    key: 'name',
    label: 'Name',
    sortable: false,
    fn: function (value, object) {
      const comp = new Component(object);
      const name = comp.getName() || comp.getKey() || object._id;
      let badge = '';
      if (companyClass.isComponentBlacklisted(comp.getKey(), '*')) {
        badge = '<span class="label label-danger m-r-xs" title="Blacklisted">B</span>';
      }
      return new Spacebars.SafeString(
        badge + '<span class="truncate max-w-400px">' + escapeHtml(name) + '</span>'
      );
    }
  };
}

const DESCRIPTION_FIELD = {
  fieldId: 'description',
  key: 'description',
  label: 'Description',
  sortable: false,
  fn: function (value, object) {
    const comp = new Component(object);
    let desc = comp.getDescription() || object.shortDescription || '';
    if (desc.length > 100) {
      desc = desc.substring(0, 100) + '...';
    }
    return desc;
  }
};

const PKG_MGR_FIELD = {
  fieldId: 'pkgMgr',
  key: 'key',
  label: 'Package',
  sortable: false,
  fn: function (value) {
    const helper = Blaze._globalHelpers && Blaze._globalHelpers.getPkgMgrIcon;
    if (helper && value) {
      return new Spacebars.SafeString(helper(value) || '');
    }
    return '';
  },
  cellClass: 'col-120 text-center'
};

const LINKS_FIELD = {
  fieldId: 'links',
  key: 'urls',
  label: 'Links',
  sortable: false,
  fn: function (value, object) {
    const comp = new Component(object);
    return new Spacebars.SafeString(
      externalLink(comp.getUrl('homepage'), 'Homepage', 'fa-home') +
      externalLink(comp.getUrl('repository'), 'Repository', 'fa-code-fork')
    );
  },
  cellClass: 'col-100'
};

Template.componentLakeResults.helpers({
  reactiveTableSettings: function () {
    const company = Session.get('company');
    const companyClass = new Company(company);
    const fields = [nameField(companyClass), DESCRIPTION_FIELD, PKG_MGR_FIELD, LINKS_FIELD];

    return {
      collection: this.rows || [],
      rowsPerPage: 15,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: fields
    };
  }
});

Template.componentLakeResults.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) {
      return;
    }
    if (this._id) {
      Router.go('componentDetail', {_id: this._id});
    }
  }
});
