import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Notify from '/imports/api/notify';
/* global swal */

function normalizeStats(stats) {
  if (!stats) return null;

  // Components count
  let compCount = typeof stats.components === 'number' ? stats.components : 0;
  if (!compCount && stats.vulnerability && stats.vulnerability.componentsTotal) {
    compCount = stats.vulnerability.componentsTotal;
  }
  if (!compCount && stats.licenses && typeof stats.licenses === 'object' && stats.licenses.components) {
    compCount = stats.licenses.components;
  }

  // Licenses count
  let licCount = 0;
  let l = stats.licenses;
  if (l && typeof l === 'object') {
    licCount = l.licenses || 0;
  } else if (typeof l === 'number') {
    licCount = l;
  }

  // Status rows
  let rows = [];

  // Legal - module: stats.legal; release: stats.licenses (componentWarnings/componentViolations)
  let legal = stats.legal;
  if (legal && (legal.warnings || legal.violations)) {
    rows.push({label: 'Legal', warnings: legal.warnings || 0, violations: legal.violations || 0});
  } else if (l && typeof l === 'object') {
    rows.push({
      label: 'Legal',
      warnings: l.warnings || l.componentWarnings || 0,
      violations: l.violations || l.componentViolations || 0
    });
  } else {
    rows.push({label: 'Legal', warnings: 0, violations: 0});
  }

  let v = stats.vulnerability || {};
  rows.push({
    label: 'Vulnerability',
    warnings: v.warnings || 0,
    violations: v.violations || v.vulnerability || 0
  });

  let vi = stats.viability || {};
  rows.push({
    label: 'Viability',
    warnings: vi.warnings || vi.withoutViability || 0,
    violations: vi.violations || 0
  });

  let ver = stats.versioning || {};
  rows.push({label: 'Versioning', warnings: ver.warnings || 0, violations: ver.violations || 0});

  if (stats.encryption) {
    rows.push({label: 'Encryption', warnings: stats.encryption.warnings || 0, violations: stats.encryption.violations || 0});
  } else {
    rows.push({label: 'Encryption', na: true});
  }

  if (stats.endoflife) {
    rows.push({label: 'End of Life', warnings: stats.endoflife.warnings || 0, violations: stats.endoflife.violations || 0});
  } else {
    rows.push({label: 'End of Life', na: true});
  }

  return {components: compCount, licenses: licCount, rows: rows};
}

Template.componentLinkedModuleStats.events({
  'click .remove-link-module': function () {
    let link = this;
    let moduleId = link.moduleId || Router.current().params.moduleId;
    let label = (link.module && link.module.name) || (link.approve && link.approve.name) || 'this link';
    if (moduleId) {
      swal({
        title: 'Remove link?',
        text: 'Are you sure you want to remove link to "' + label + '"?',
        type: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d9534f',
        confirmButtonText: 'Remove',
        cancelButtonText: 'Cancel'
      }, function (confirmed) {
        if (confirmed) {
          Meteor.callAsync('componentUnlinkWithModule', {link: link, moduleId: moduleId}).then(function (data) {
            if (data === 1) {
              Notify.success('Link successfully removed');
            }
          });
        }
      });
    }
  }
});

Template.componentLinkedModuleStats.helpers({
  getModuleRouteOptions: function () {
    if (this.module && this.module._id) {
      return {moduleId: this.module._id, projectId: this.module.projectId || '_'};
    }
    return {};
  },
  getReleaseRouteOptions: function () {
    if (this.approve && this.approve._id) {
      return {approveId: this.approve._id};
    }
    return {};
  },
  normalizedStats: function () {
    return normalizeStats(this.stats);
  },
  getProjectLabel: function () {
    if (this.module && this.module.projectName) return this.module.projectName;
    if (this.approve && this.approve.projectName) return this.approve.projectName;
    return null;
  }
});
