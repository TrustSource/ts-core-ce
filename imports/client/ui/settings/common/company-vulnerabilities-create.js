import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import Modules from '/imports/lib/collections/modules';

function resetForm() {
  let form = $('#addVulnerabilityForm');
  if(form.length){
    form.validate().resetForm();
  }
  form.find('[name=vulnerabilityKey]').val('').removeClass('error');
  form.find('[name=vulnerabilitySeverity]').val('critical').removeClass('error');
  form.find('[name=vulnerabilityDescription]').val('').removeClass('error');
  form.find('[name=vulnerabilityScore]').val('').removeClass('error');
  form.find('[name=vulnerabilityLink]').val('').removeClass('error');
}

Template.companyManualVulnerabilitiesCreate.onRendered(function () {
  const version = this.data.version;
  if(version){
    let component = version.component;
    Session.set('customComponent',{
      'name' : component.getName(),
      'key' : component.getKey(),
      'description' : component.getDescription(),
      'homepageUrl' : component.getUrl('homepage') || null,
      'repoUrl' : component.getUrl('repository') || null,
      'dependencies' : [],
      'versions' : [version.getVersion()]
    });
  }
  $('#addVulnerabilityForm').validate({
    rules: {
      vulnerabilityKey: {
        required: true
      },
      vulnerabilitySeverity: {
        required: false
      },
      vulnerabilityDescription: {
        required: false
      },
      vulnerabilityScore: {
        required: false
      },
      vulnerabilityLink: {
        required: false
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (form) {
      let vulnerabilityKey = $(form).find('[name=vulnerabilityKey]').val();
      let severity = $(form).find('[name=vulnerabilitySeverity]').val();
      let score = $(form).find('[name=vulnerabilityScore]').val();
      let link = $(form).find('[name=vulnerabilityLink]').val();
      let vulnerabilityDescription = $(form).find('[name=vulnerabilityDescription]').val();
      if(!Session.get('customComponent')){
        Notify.warn('Select component version first');
        return
      }
      let {name, key, description,  versions} = Session.get('customComponent');
      const vulnerability = {
        key: vulnerabilityKey,
        severity,
        link,
        description: vulnerabilityDescription,
        score,
        component: {name, key, description, version: versions[0]}
      };
      Meteor.callAsync('ManualVulnerabilities.Create', vulnerability).then(function() {
        const message = 'New vulnerability ' + vulnerabilityKey + ' created';
        const moduleId = Router.current().params && Router.current().params.moduleId;
        if(moduleId){
          Modules.updateAsync(moduleId, {$set: {analysisRequired: true}});
        }
        if(Session.get('currentComponent')){
          Notify.successHtml('Manual vulnerability created! <br>' +
            'NOTE: Vulnerability will not appear in the component or legal views until you have executed ' +
            'a new analysis run!  The views actually are representations of an analysis result.');
        }else{
          Notify.success(message);
        }
        Meteor.setTimeout(function () {
          $('#createManualVulnerability').modal('hide');
        }, 300);
      }).catch(function(error) {
        const message = 'Internal Error: ' + (error.reason || 'could not create vulnerability');
        Notify.danger(message);
      });
    }
  });

  $('#createManualVulnerability').off('.companyManualVulnerabilitiesCreate')
    .on('show.bs.modal.companyManualVulnerabilitiesCreate', function () { resetForm(); })
    .on('hidden.bs.modal.companyManualVulnerabilitiesCreate', function () { resetForm(); });
});

Template.companyManualVulnerabilitiesCreate.onDestroyed(function () {
  $('#createManualVulnerability').off('.companyManualVulnerabilitiesCreate');
});

Template.companyManualVulnerabilitiesCreate.events({
  'submit #addVulnerabilityForm': function (event) {
    event.preventDefault();
  }
});

Template.companyManualVulnerabilitiesCreate.helpers({
  hasVersion: function () {
    return this.version
  },

  customComponent: function () {
    return Session.get('customComponent')
  }
});
