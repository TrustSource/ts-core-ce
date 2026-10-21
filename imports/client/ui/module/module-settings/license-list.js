import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {AutoForm} from 'meteor/aldeed:autoform';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Roles} from 'meteor/alanning:roles';
import {$} from 'meteor/jquery';
import {Tracker} from 'meteor/tracker';
import LicensesService from '/imports/api/licenses';
import Licenses from '/imports/lib/collections/licenses';
import {ListHelper} from '/imports/client/ui/lib/ListHelper';
import Projects from '/imports/lib/collections/projects';

const FROM_UPPER = 'from-upper'

// Decode the `__DOT__` placeholder used in option values to dodge the
// afQuickField "." bug - see `licenseOptions` / `getDataForForm`.
function decodeKey(value) {
  return value ? String(value).replace(/__DOT__/g, '.') : '';
}

// Match by both license name (option text) and license key (option id).
// select2's default only matches the visible text; users expect to type
// "Apache-2.0" or "MIT" and find the matching license.
function licenseMatcher(params, data) {
  const term = (params.term || '').trim().toLowerCase();
  if (!term) return data;
  if (!data || data.id === undefined || data.id === '') return null;
  const text = (data.text || '').toLowerCase();
  const key = decodeKey(data.id).toLowerCase();
  return (text.indexOf(term) !== -1 || key.indexOf(term) !== -1) ? data : null;
}

// Render each option as "Name <small>key</small>" so the key is visible
// alongside the name - the matcher searches both, so users see what
// they're filtering on.
function licenseTemplateResult(data) {
  if (!data || !data.id) return data && data.text;
  const key = decodeKey(data.id);
  const name = data.text || '';
  if (!key || key === name) return name;
  const $row = $('<span></span>');
  $row.append($('<span></span>').text(name));
  $row.append(' ');
  $row.append($('<small class="text-muted"></small>').text(key));
  return $row;
}

Template.moduleLicenseList.onRendered(function () {
  let context = Template.currentData();
  if(!context || context && !context.id){
    context = Template.parentData();
  }
  const company = Session.get('company');
  const project = Projects.findOne(Router.current().params.projectId);
  let requireWhitelist = company && company.requireWhitelist || project && project.requireWhitelist;
  if (context) {
    ListHelper.clearSession(context.id);
    AutoForm.addHooks(context.id, {
      onSubmit: ListHelper.getOnSubmitHook(['key'], false, context.userUpdate, requireWhitelist),
      onError: ListHelper.getOnErrorHook()
    }, true);
  }
  // Re-init LicensesService if list is empty (subscription may not have been ready at startup)
  if (!LicensesService.list.length) {
    LicensesService.init();
  }
  // Init/re-init select2 whenever AutoForm re-renders the select. We
  // need to react to (a) row click → form repopulates, (b) Licenses
  // subscription delivering → options populate AFTER the form has
  // already mounted, (c) the parent's data context changing. Without
  // (b) the select renders option-less, select2 attaches to nothing,
  // and the later option flush surfaces a native dropdown - exactly
  // the bug reported.
  const tpl = this;
  const formId = context && context.id;
  if (formId) {
    tpl.autorun(function () {
      Session.get(formId + 'SelIdx');
      Licenses.find({}, {fields: {_id: 1}}).count();
      Tracker.afterFlush(function () {
        // Re-sync the in-memory list when the subscription delivers
        // (LicensesService.list is plain, not reactive, so we refresh
        // it here so `licenseOptions` returns populated data on the
        // next Blaze render).
        if (!LicensesService.list.length) {
          LicensesService.init();
        }
        const $select = tpl.$('select[name="key"]');
        if (!$select || !$select.length) return;
        if ($select.data('select2')) {
          $select.select2('destroy');
        }
        $select.select2({
          width: '100%',
          matcher: licenseMatcher,
          templateResult: licenseTemplateResult
        });
      });
    });
  }
});

Template.moduleLicenseList.onDestroyed(function () {
  const $select = this.$('select[name="key"]');
  if ($select && $select.data('select2')) {
    $select.select2('destroy');
  }
  const context = Template.currentData();
  if (context) {
    ListHelper.clearSession(context.id);
  }
});

Template.moduleLicenseList.helpers({
  getDataForForm: function () {
    const selectedIndex = ListHelper.getSelectedIndex(this.id, this.data);
    // Copy: these two are form-only fields; writing them onto the stored entry leaked
    // `index` into MongoDB.
    const data = Object.assign({}, this.data && this.data[selectedIndex] || {},
      {_id: this.docId, index: selectedIndex});
    // TODO This fix related to problem with afQuickField and value mapping if value contains .
    data.key = data.key ? data.key.replace(/\./g, '__DOT__') : data.key
    return data;
  },

  encodeValue(value) {
    // TODO This fix related to problem with afQuickField and value mapping if value contains .
    return value ? value.replace(/\./g, '__DOT__') : value
  },

  isNotApproved: function () {
    if(this.collection){
      const selectedIndex = ListHelper.getSelectedIndex(this.id, this.data);
      // Copy: these two are form-only fields; writing them onto the stored entry leaked
      // `index` into MongoDB.
      const data = Object.assign({}, this.data && this.data[selectedIndex] || {},
        {_id: this.docId, index: selectedIndex});
      return data.approved === false;
    }else{
      return (this.approved === false)  ? 'not-approved' : ''
    }
  },

  licenseOptions: function () {
    // Reactively count Licenses so this helper re-runs the moment the
    // subscription delivers - `LicensesService.list` is a plain array
    // and would otherwise leave the <select> empty on first render.
    Licenses.find({}, {fields: {_id: 1}}).count();
    if (!LicensesService.list.length) {
      LicensesService.init();
    }
    return LicensesService.list.map(function (lic) {
      // TODO This fix related to problem with afQuickField and value mapping if value contains .
      return {label: lic.name, value: lic.key ? lic.key.replace(/\./g, '__DOT__') : lic.key};
    });
  },

  getLicenses: function () {
    const seen = new Set();
    const items = _.filter(_.map(this.data || [], function (o, i) {
      // Copy: `index` is display-only and must not be written onto the stored entry.
      return ListHelper.withDisplayIndex(o, i);
    }), function (o) {
      if (o._id && seen.has(o._id)) return false;
      if (o._id) seen.add(o._id);
      return true;
    });
    return _.sortBy(items, function (item) {
      const license = LicensesService.find(item.key ? item.key.replace(/__DOT__/g, '.') : item.key);
      return (license && license.name || item.key || '').toLowerCase();
    });
  },

  getLicense: function (key) {
    // TODO This fix related to problem with afQuickField and value mapping if value contains .
    let fixedKey = key ? key.replace(/__DOT__/g, '.') : key;
    const license = LicensesService.find(fixedKey);
    return license && license.name || '';
  },

  getErrorMsg: function () {
    return Session.get(this.id + 'ErrorMsg');
  },

  getSubmitLabel: function () {
    return ListHelper.getSelectedIndex(this.id, this.data) >= 0 ? 'Update' : 'Add';
  },

  getCancelRequired: function () {
    return ListHelper.getSelectedIndex(this.id, this.data) >= 0;
  },

  isFromProject: function () {
    return this.projectItem ? FROM_UPPER : ''
  },

  isFromUser: function () {
    return this.userItem ? FROM_UPPER : ''
  },

  isFromCompany: function () {
    return this.companyItem ? FROM_UPPER : ''
  },

  getProjectOptions: function () {
    return {
      projectId: Router.current().params.projectId
    };
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }

});

Template.moduleLicenseList.events({
  // "this" points to table row data, context is archived with Template.currentData();
  'click .select-component:not(.from-upper)': function (event) {
    event.preventDefault();
    $(event.currentTarget).addClass('highlight').siblings().removeClass('highlight');
    const context = Template.currentData();
    const valContext = AutoForm.getValidationContext(context.id);
    if (valContext && !valContext.isValid()) {
      AutoForm.resetForm(context.id);
    }
    Session.set(context.id + 'SelIdx', this.index);
    Session.set(context.id + 'ErrorMsg', undefined);
  },
  'click .approve-item': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    if (self.data instanceof Array) {
      const index = ListHelper.getSelectedIndex(self.id, self.data);
      const originalData = _.reject(self.data, function (elem) {
        return elem.projectItem === true || elem.companyItem === true;
      }) || [];
      self.data[index].approved = true;
      const dataWithout = ListHelper.forStorage(_.reject(self.data, function (elem) {
        return elem.projectItem === true || elem.companyItem === true;
      }) || []);
      if (self.userUpdate) {
        Meteor.callAsync('updateUserConfig', self.attribute, dataWithout).catch(function (error) {
          console.log(error);
        })
      } else {
        Meteor.callAsync('updateCollection', self.collection._name, self.docId, self.attribute, dataWithout, true, originalData);
      }
    }
    ListHelper.clearSession(self.id);
  },
  'click #cancel': function (event) {
    event.preventDefault();
    $('table.' + this.id + ' tbody tr').removeClass('highlight');
    ListHelper.clearSession(this.id);
  },
  'click #delete': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    if (self.data instanceof Array) {
      const index = ListHelper.getSelectedIndex(self.id, self.data);
      const originalData = _.reject(self.data, function (elem) {
        return elem.projectItem === true || elem.companyItem === true;
      }) || [];
      const element = self.data[index];
      this.data.splice(index, 1);
      const dataWithout = ListHelper.forStorage(_.reject(self.data, function (elem) {
        return elem.projectItem === true || elem.companyItem === true;
      }) || []);
      if (this.userUpdate) {
        Meteor.callAsync('updateUserConfig', self.attribute, dataWithout).catch(function (error) {
          console.log(error);
        })
      } else {
        const user = Meteor.user();
        const company = Session.get('company');
        const project = Projects.findOne(Router.current().params.projectId);
        let requireWhitelist = company && company.requireWhitelist || project && project.requireWhitelist;
        Meteor.callAsync('updateCollection', self.collection._name, self.docId, self.attribute, dataWithout, true, originalData);
        if(element.approved === false && requireWhitelist && Roles.userIsInRole(user._id, 'compliance_manager', user.profile.companyId)){
          Meteor.callAsync('notifyAboutWhiteListedReject',user,element,element.comment,
            self.collection._name,self.collection.findOne(self.docId).name,true);
        }
      }
    }
    ListHelper.clearSession(self.id);
  }
});
