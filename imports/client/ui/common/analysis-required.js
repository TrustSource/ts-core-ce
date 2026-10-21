import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import Notify from '/imports/api/notify';

Template.analysisRequired.events({
  'click .analysis_required': function (event) {
    event.preventDefault();
    event.stopPropagation();
    let module = this.item && (this.item.name ? this.item : this.item.data());
    Notify.success('Analysis started');
    let method = 'analyzeModule';
    if((module.infrastructureComponent && module.infrastructureComponent.key) ||
      (module.cotsComponent && module.cotsComponent.key)){
      method = 'Modules.AnalyzeWithoutScan'
    }
    Meteor.callAsync(method, module._id).then(function() {
      Notify.success('Module was successfully analyzed.');
    }).catch(function(error) {
      Notify.danger('Analysis error: '+ (error.reason));
    })
  }
});

Template.analysisRequired.helpers({
  analysisRequired: function () {
    let module = this.item && (this.item.name ? this.item : typeof this.item.data === 'function' && this.item.data());
    if(module){
      return module.analysisRequired
    }
  }
});
