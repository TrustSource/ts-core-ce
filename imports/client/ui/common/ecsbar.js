import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';

function onRendered () {
  $('.ecsbars').tooltip({
    selector: '[data-toggle=tooltip]'
  });
}

Template.ecsbar.onRendered(onRendered);


Template.ecsbars.events({
  'click .disable-notification-compact': function (event) {
    event.stopPropagation();
  }
});

Template.ecsbars.helpers({
  statistics: function () {
    const module = Template.currentData();
    const filter = Router.current().params.query.analysis || null;
    const statistics = module && module.getStatistics(filter);
    return statistics && statistics.getAll();
  },

  isVersioningDisabled: function () {
    const module = Template.parentData();
    return (module && module.moduleIdentifier) && !(module && module.versioningConfig && module.versioningConfig.enabled)
  },

  getModuleOptions: function () {
    const module = Template.parentData();
    return {
      moduleId:module._id,
      projectId:Router.current().params.projectId
    };
  }
});

Template.ecsbarLine.onRendered(onRendered);

Template.ecsbarLine.helpers({
  getOkPercent: function (data) {
    return data && data.ok ? (data.ok / data.total * 100).toFixed(0) : '0';
  }
});
