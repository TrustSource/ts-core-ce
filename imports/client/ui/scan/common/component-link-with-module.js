import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Notify from '/imports/api/notify';
import {$} from 'meteor/jquery';

const ERROR_LINKING = 'Error creating link:';

let _componentData = null;
let _moduleId = null;

Template.componentLinkWithModule.onCreated(function () {
  this.loading = new ReactiveVar(false);
  this.data_ = new ReactiveVar(null); // {modules, releases}
  this.linkType = new ReactiveVar('module');
});

function fetchData(instance, excludeModuleId) {
  instance.loading.set(true);
  Meteor.callAsync('getModulesForLinking', {excludeModuleId}).then(function (data) {
    instance.data_.set(data || {modules: [], releases: []});
    instance.loading.set(false);
    Meteor.setTimeout(function () {
      initSelect2();
    }, 50);
  }).catch(function () {
    instance.loading.set(false);
  });
}

function initSelect2() {
  let modal = $('#componentLinkWithModuleModal');
  modal.find('#linkTypeSelect').each(function () {
    if (!$(this).data('select2')) {
      $(this).select2({width: '100%', dropdownParent: modal, minimumResultsForSearch: Infinity});
    }
  });
  modal.find('#linkModuleSelect, #linkReleaseSelect').each(function () {
    if (!$(this).data('select2')) {
      $(this).select2({width: '100%', dropdownParent: modal});
    }
  });
}

function refreshModuleData() {
  // Module data is reactive via Modules.findOne() - no manual refresh needed
  // But scan-detail view may still need scan refresh
  let params = Router.current().params;
  if (params && params.moduleId) {
    let analysisId = params.query && params.query.analysis;
    Meteor.callAsync('getLastModuleScan', params.moduleId, analysisId).then(function (scan) {
      Session.set('moduleLastScan', scan);
    });
  }
}

function closeModal() {
  let modal = $('#componentLinkWithModuleModal');
  modal.modal('hide');
  Meteor.setTimeout(function () {
    $('.modal-backdrop').remove();
    $('body').removeClass('modal-open').css({'padding-right': 0});
  }, 300);
}

function submitLink(instance) {
  let modal = $('#componentLinkWithModuleModal');
  let type = instance.linkType.get();
  let data = instance.data_.get();

  if (!_componentData || !_moduleId) {
    Notify.danger('Component data not available. Please close and reopen.');
    return;
  }

  let props = {
    moduleId: _moduleId,
    component: {
      _id: _componentData.component ? _componentData.component._id : _componentData._id,
      key: _componentData.key,
      versions: _componentData.versions
    }
  };

  if (type === 'module') {
    let moduleId = modal.find('#linkModuleSelect').val();
    if (!moduleId) {
      Notify.warn('Please select a module');
      return;
    }
    let selectedModule = data.modules.find(function (m) { return m._id === moduleId; });
    if (!selectedModule) return;
    props.module = {_id: selectedModule._id, name: selectedModule.name, version: selectedModule.version};
    props.approve = null;
  } else {
    let releaseId = modal.find('#linkReleaseSelect').val();
    if (!releaseId) {
      Notify.warn('Please select a release');
      return;
    }
    let selectedRelease = data.releases.find(function (r) { return r._id === releaseId; });
    if (!selectedRelease) return;
    props.module = null;
    props.approve = {_id: selectedRelease._id, name: selectedRelease.name, version: selectedRelease.version};
  }

  Meteor.callAsync('componentLinkWithModule', props).then(function (result) {
    if (result === 1) {
      closeModal();
      refreshModuleData();
      Notify.success('Link successfully created');
    } else {
      Notify.danger(ERROR_LINKING);
    }
  }).catch(function (err) {
    Notify.danger(ERROR_LINKING + ' ' + (err.reason || err.message));
  });
}

function groupByProject(items, nameField) {
  let groups = {};
  items.forEach(function (item) {
    let pName = item.projectName || 'Unassigned';
    if (!groups[pName]) {
      groups[pName] = {projectName: pName};
      groups[pName][nameField] = [];
    }
    groups[pName][nameField].push(item);
  });
  return Object.keys(groups).sort().map(function (key) {
    groups[key][nameField].sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });
    return groups[key];
  });
}

Template.componentLinkWithModule.events({
  'click .link-with-module': function () {
    let instance = Template.instance();
    _componentData = instance.data && instance.data.component;
    _moduleId = instance.data && instance.data.moduleId;
    if (_componentData && !instance.data_.get()) {
      fetchData(instance, instance.data.excludeModuleId);
    }
    instance.linkType.set('module');
    let modal = $('#componentLinkWithModuleModal');
    modal.modal('show');
    modal.off('shown.bs.modal.linkInit').on('shown.bs.modal.linkInit', function () {
      initSelect2();
      modal.off('click.linkConfirm', '.confirm-link-module').on('click.linkConfirm', '.confirm-link-module', function () {
        submitLink(instance);
      });
      modal.off('change.linkType', '#linkTypeSelect').on('change.linkType', '#linkTypeSelect', function () {
        instance.linkType.set($(this).val());
        Meteor.setTimeout(function () {
          initSelect2();
        }, 100);
      });
    });
  }
  // NOTE: no Blaze events for elements inside #componentLinkWithModuleModal -
  // the modal is moved to <body> on show, so they are bound directly on the
  // modal element in the .link-with-module handler above.
});

Template.componentLinkWithModule.helpers({
  loading: function () {
    return Template.instance().loading.get();
  },
  isModuleType: function () {
    return Template.instance().linkType.get() === 'module';
  },
  modulesGrouped: function () {
    let data = Template.instance().data_.get();
    return data ? groupByProject(data.modules || [], 'modules') : [];
  },
  releasesGrouped: function () {
    let data = Template.instance().data_.get();
    return data ? groupByProject(data.releases || [], 'releases') : [];
  },
  hasModuleLink: function () {
    let instance = Template.instance();
    let component = instance.data && instance.data.component;
    let linkedModules = instance.data && instance.data.linkedModules;
    if (linkedModules && component) {
      let matched = linkedModules.find(function (item) {
        return item.key === component.key;
      });
      return matched || false;
    }
    return false;
  },
  getLinkedRouteOptions: function () {
    if (this.module && this.module._id) {
      return {moduleId: this.module._id, projectId: this.module.projectId || '_'};
    }
    return {};
  },
  getLinkLabel: function () {
    if (this.module && this.module.name) return this.module.name;
    if (this.approve && this.approve.name) return this.approve.name;
    return 'Linked';
  }
});
