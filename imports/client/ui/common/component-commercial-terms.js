import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import Notify from '/imports/api/notify';
import Components from '/imports/lib/collections/components';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import COTSComponents from '/imports/lib/collections/cotsComponents';

Template.componentCommercialTerms.helpers({
  commercialTerms: function () {
    return this.component && this.component.commercialTerms
  },
  compare: function (a, b) {
    return a === b
  }
});

function updateComponent(component, collection, modifier){
  let componentId;
  if(collection === 'cotsComponents'){
    componentId = COTSComponents.updateAsync(component._id, modifier);
  }else if (collection === 'infrastructureComponents'){
    componentId = InfrastructureComponents.updateAsync(component._id, modifier);
  }else {
    componentId = Components.updateAsync(component._id, modifier);
  }
  if(componentId){
    let user = Meteor.user();
    Meteor.callAsync('logEvent', user, 'Component '+component.name+' commercial terms changed', 'commercialTermsUpdated').catch(function() {});
    Notify.success('Commercial terms updated for component: ' + (component.name));
  }
}

Template.componentCommercialTerms.events({
  'click [name="commercialTerms.RS"]': function (event) {
    const newVal = event.target.value;
    const component = this.component;
    const collection = this.collection;
    if (newVal !== (this.commercialTerms && this.commercialTerms.RS) && component) {
      let modifier = {$set: {'commercialTerms.RS': newVal}};
      updateComponent(component, collection, modifier)
    }
  },
  'click [name="commercialTerms.D"]': function (event) {
    const newVal = event.target.value;
    const component = this.component;
    const collection = this.collection;
    if (newVal !== (this.commercialTerms && this.commercialTerms.D) && component) {
      let modifier = {$set: {'commercialTerms.D': newVal}};
      updateComponent(component, collection, modifier)
    }
  },
  'click [name="commercialTerms.SA"]': function (event) {
    const newVal = event.target.value;
    const component = this.component;
    const collection = this.collection;
    if (newVal !== (this.commercialTerms && this.commercialTerms.SA) && component) {
      let modifier = {$set: {'commercialTerms.SA': newVal}};
      updateComponent(component, collection, modifier)
    }
  },
  'click [name="commercialTerms.M"]': function (event) {
    const newVal = event.target.value;
    const component = this.component;
    const collection = this.collection;
    if (newVal !== (this.commercialTerms && this.commercialTerms.M) && component) {
      let modifier = {$set: {'commercialTerms.M': newVal}};
      updateComponent(component, collection, modifier)
    }
  }
});
