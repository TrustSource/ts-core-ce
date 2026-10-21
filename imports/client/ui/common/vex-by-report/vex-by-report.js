/* global Blob:false, document:false, window:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import VEX from '/imports/lib/converter/vex';
import Notify from '/imports/api/notify';

Template.vexByReport.onCreated(function () {
  let loading = new ReactiveVar();
  let details = new ReactiveVar();
  this.details = details;
  this.loading = loading;
});

Template.vexByReport.helpers({
  reportData: function () {
    const instance = Template.instance();
    return instance.details && instance.details.get()
  },
  isLoading: function () {
    const instance = Template.instance();
    return instance.loading && instance.loading.get()
  }
});

function getName(data) {
  return data.modules && data.modules.length === 1 ? data.modules && data.modules[0].name || 'Module is N.A.'
    : data.project && data.project.name || 'Project is N.A.';
}

Template.vexByReport.events({
  'click .export-as-vex': async function () {
    const instance = Template.instance();
    if(instance.data && instance.details && !instance.details.get()){
      instance.loading.set(true)
      let data
      try {
        // The product_id obfuscation secret lives on the server now, so the
        // tokens for this report's modules are minted there - once, for the
        // whole set, before anything is generated. A refused mint therefore
        // costs no generation and files no draft.
        const modules = (instance.data.data && instance.data.data.modules) || []
        const productIds = await Meteor.callAsync('CSAF.EncodeModuleIds', modules.map(function (module) {
          return module._id
        }))
        data = await VEX.fromVulnerabilityReport(instance.data.data, instance.data.confidenceCurrent, true, productIds)
      } catch (error) {
        // FAIL CLOSED. This button passes createCSAF = true, so it files a draft
        // advisory before it downloads anything - and since b42c538fc CSAF.Create
        // enforces a server-side role check, which makes a 403 here an everyday
        // outcome rather than a theoretical one. Handing over a JSON file the
        // server just refused to store would tell the user the export worked.
        //
        // Without this the rejection escaped as an unhandled one and left
        // `loading` true for good: a spinner that never stops on a button that
        // can never be pressed again.
        instance.loading.set(false)
        Notify.danger('CSAF creation failed: ' + (error && error.message ? error.message : error));
        return;
      }
      instance.details.set(data)
      instance.loading.set(false)
    }
    let reportData = instance.details.get()
    let blob = new Blob([JSON.stringify(reportData, null, 2)]);
    if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
      window.navigator.msSaveBlob(blob, getName(instance.data.data)+'-CSAF.json');
    else{
      let a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
      a.download = getName(instance.data.data)+'-CSAF.json';
      document.body.appendChild(a);
      a.click();  // IE: "Access is denied";
      // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
      document.body.removeChild(a);
    }
  }
})
