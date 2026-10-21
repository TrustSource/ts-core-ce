/* global window:false, document:false, Blob:false, performance:false, swal: false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import uuid from 'uuid';
import Notify from '/imports/api/notify';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';
import reportSbomFileService from '/imports/lib/reports/reportSbomFileService';
import {getChartSliceColors, getCycloneDxVariant} from '/imports/client/ui/reports/report-sbom/sbomDetailsHelpers';

const FILE_NAME = '-sbom-file-'
const PAGE_SIZE = 50;

Template.sbomFileDetails.onCreated(function () {
  this.currentPage = new ReactiveVar(0);
});

Template.sbomFileDetails.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  Session.set('showDetails');
  Session.set('showDetailsTree');
  Session.set('noticeShowUnknownLicense');
  Session.set('showAll', true);
});

Template.sbomFileDetails.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

function getOptimizedLicenseKey(key) {
  return key && key.split(/[.#:@/() ]/).join('') || 'unknown'
}

function processChartProgress(data) {
  const options = {
    type: 'pie',
    width: '80px',
    height: '80px',
    sliceColors: getChartSliceColors(document.body.classList.contains('theme-dark')),
    offset: -90
  };
  if(data){
    const chartData = [data.completedActivity, data.totalActivity-data.completedActivity];
    Meteor.setTimeout(function () {
      $('#chart-progress-modules').sparkline(chartData, options);
    },1)
  }
}

function updateSbomFile(modifier, sbomFile, filter, componentUpdates) {
  const user = Meteor.user();
  if(sbomFile){
    let logName = sbomFile.getName();
    let completedActivity = 0;
    let componentsCount = 0;
    _.each(sbomFile.list, function (component) {
      componentsCount = componentsCount + 1;
      if (component.completed) {
        completedActivity = completedActivity + 1
      }
    });
    const totalActivity = (componentsCount || 0);
    modifier['$set'].totalActivity = totalActivity;
    modifier['$set'].completedActivity = completedActivity;
    modifier['$set'].completed = completedActivity && totalActivity ? Math.round((completedActivity/totalActivity) * 100) : 0;
    Meteor.callAsync('SbomFiles.Update', modifier, sbomFile._id, filter, componentUpdates).then(function(result) {
      if (!result) {
        let textError = 'Error: could not update SBOM file';
        Meteor.callAsync('logEvent', user, textError, 'sbomFileUpdated');
        Notify.danger(textError);
      } else {
        Notify.success('SBOM file updated!');
        Meteor.callAsync('logEvent', user, 'SBOM file '+logName+' updated', 'sbomFileUpdated');
      }
    });
  }
}

function easeInOutQuad(t){ return t<.5 ? 2*t*t : -1+(4-2*t)*t }

function getRelativePos(elm){
  let pPos = elm.parentNode.getBoundingClientRect(); // parent pos
  let cPos = elm.getBoundingClientRect(); // target pos
  return {
    top: cPos.top - pPos.top + elm.parentNode.scrollTop,
    right:cPos.right  - pPos.right,
    bottom:cPos.bottom - pPos.bottom,
    left:cPos.left   - pPos.left
  };
}

function scrollTo(element, to, duration, onDone) {
  let start = element.scrollTop,
    change = to - start,
    startTime = performance.now(),
    now, elapsed, t;

  function animateScroll(){
    now = performance.now();
    elapsed = (now - startTime)/1000;
    t = (elapsed/duration);

    element.scrollTop = start + change * easeInOutQuad(t);

    if( t < 1 )
      window.requestAnimationFrame(animateScroll);
    else
      onDone && onDone();
  }

  animateScroll();
}

function scrollToElm(box, targetElm, duration){
  let container = document.querySelector(box),
    elm = document.querySelector(targetElm);
  let pos = getRelativePos(elm);
  scrollTo( container, pos.top, duration/1000);  // duration in seconds
}

Template.sbomFileDetails.events({

  'click .expand_table': function (event) {
    event.preventDefault();
    const license = this;
    let details = Session.get('showDetails') || [];
    let isShowDetails = _.any(details,function (item) {
      return item === getOptimizedLicenseKey(license.key)
    });
    if(isShowDetails){
      details = _.reject(details,function (item) {
        return item === getOptimizedLicenseKey(license.key)
      });
    }else{
      details.push(getOptimizedLicenseKey(license.key));
    }
    Session.set('showDetails', details);
    Session.set('loadingInProgress',true);
    Meteor.setTimeout(function () {
      Session.set('loadingInProgress',false);
      const panelEl = $(event.target).parents('.panel-'+getOptimizedLicenseKey(license.key));
      const icon = panelEl.find('.show_hide');
      icon.toggleClass('fa-chevron-right').toggleClass('fa-chevron-down');
      panelEl.toggleClass('').toggleClass('collapsed');
    },1);
  },

  'click .expand_tree': function (event) {
    event.preventDefault();
    const license = this;
    let details = Session.get('showDetailsTree') || [];
    let isShowDetails = _.any(details,function (item) {
      return item === getOptimizedLicenseKey(license.key)
    });
    if(isShowDetails){
      details = _.reject(details,function (item) {
        return item === getOptimizedLicenseKey(license.key)
      });
    }else{
      details.push(getOptimizedLicenseKey(license.key));
    }
    Session.set('showDetailsTree', details);
    Session.set('loadingInProgress',true);
    Meteor.setTimeout(function () {
      Session.set('loadingInProgress',false);
      const panelEl = $(event.target).parents('.panel-'+getOptimizedLicenseKey(license.key));
      const icon = panelEl.find('.show_hide');
      icon.toggleClass('fa-folder').toggleClass('fa-folder-open');
      panelEl.toggleClass('').toggleClass('collapsed');
    },1);
  },

  'change .on_update_complete': function (event) {
    event.preventDefault();
    const sbomFile = Template.currentData();
    const completed = event.target.checked;
    const element = this;
    element.completed = completed;
    const component = $(event.target).closest('.panel_with_component').attr('data-component-key');
    let componentObject = _.find(sbomFile.list, function (componentItem) {
      return getOptimizedLicenseKey(componentItem.key) === component
    });
    if(componentObject){
      componentObject.completed = completed
    }
    updateSbomFile({
      '$set':{
        'list.$': componentObject || element
      }
    },sbomFile, {_id: sbomFile._id, list: {
      $elemMatch:{
        key: componentObject && componentObject.key || element.key
      }}
    });
  },

  'click .scroll_to_section': function (event, instance) {
    event.preventDefault();
    const componentKey = $(event.target).closest('.panel_with_component').attr('data-component-key');
    const sbomFile = Template.currentData();
    if (sbomFile && sbomFile.list) {
      const index = _.findIndex(sbomFile.list, function (item) {
        return getOptimizedLicenseKey(item.key) === componentKey;
      });
      if (index >= 0) {
        const targetPage = Math.floor(index / PAGE_SIZE);
        instance.currentPage.set(targetPage);
        Meteor.setTimeout(function () {
          scrollToElm('.sbom-view-left', '.panel-' + componentKey, 600);
        }, 50);
      }
    }
  },

  'click .sbom-page-prev': function (event, instance) {
    event.preventDefault();
    const current = instance.currentPage.get();
    if (current > 0) {
      instance.currentPage.set(current - 1);
      $('.sbom-view-left').scrollTop(0);
    }
  },

  'click .sbom-page-next': function (event, instance) {
    event.preventDefault();
    const current = instance.currentPage.get();
    const sbomFile = Template.currentData();
    const totalPages = sbomFile && sbomFile.list ? Math.ceil(sbomFile.list.length / PAGE_SIZE) : 1;
    if (current < totalPages - 1) {
      instance.currentPage.set(current + 1);
      $('.sbom-view-left').scrollTop(0);
    }
  },

  'change .sbom-page-input': function (event, instance) {
    event.preventDefault();
    const sbomFile = Template.currentData();
    const totalPages = sbomFile && sbomFile.list ? Math.ceil(sbomFile.list.length / PAGE_SIZE) : 1;
    let page = parseInt($(event.target).val(), 10);
    if (isNaN(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    instance.currentPage.set(page - 1);
    $(event.target).val(page);
    $('.sbom-view-left').scrollTop(0);
  },

  'click .freeze_version': function (event) {
    event.preventDefault();
    const sbomFile = this;
    let logName = sbomFile.getName();
    swal({
      title: 'Are you sure you want to freeze SBOM file ' + logName + '?',
      text: 'You will not be able to change frozen SBOM file, but copy of it will be created with increased version!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, freeze it!'
    }, function () {
      Meteor.callAsync('SbomFiles.Freeze', sbomFile._id).then(function() {
        const user = Meteor.user();
        let textSuccess = 'SBOM file '+logName+' has been frozen';
        Meteor.callAsync('logEvent', user, textSuccess, 'sbomFileFreeze');
        Notify.success(textSuccess);
      }).catch(function(error) {
        const user = Meteor.user();
        let textError = 'Error: ' + (error.reason || ' could not freeze SBOM file');
        Meteor.callAsync('logEvent', user, textError, 'sbomFileFreeze');
        Notify.danger(textError);
      });
    });
  },

  'click .export_as_pdf_report': function () {
    let reportData = this;
    let report = reportSbomFileService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.getName()+FILE_NAME+reportData.version+'.pdf')
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  },
  'click .export-as-cyclonedx': function (event) {
    let variant = getCycloneDxVariant(event.currentTarget && event.currentTarget.getAttribute('data-variant'));
    let reportData = this;
    let report = reportSbomFileService.getCycloneDxDetails(reportData, variant.type);
    let blob = new Blob([JSON.stringify(report, null, 2)]);
    if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
      window.navigator.msSaveBlob(blob, reportData.getName()+variant.suffix+reportData.version+'.json');
    else{
      let a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
      a.download = reportData.getName()+variant.suffix+reportData.version+'.json';
      document.body.appendChild(a);
      a.click();  // IE: "Access is denied";
      // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
      document.body.removeChild(a);
    }
  },
  'click .export-as-spdx': function () {
    let reportData = this;
    let report = reportSbomFileService.getSPDXDetails(reportData);
    let blob = new Blob([JSON.stringify(report, null, 2)]);
    if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
      window.navigator.msSaveBlob(blob, reportData.getName()+FILE_NAME+reportData.version+'.spdx.json');
    else{
      let a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
      a.download = reportData.getName()+FILE_NAME+reportData.version+'.spdx.json';
      document.body.appendChild(a);
      a.click();  // IE: "Access is denied";
      // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
      document.body.removeChild(a);
    }
  },

  'change .on_writtenOfferEnabled': function (event) {
    event.preventDefault();
    const sbomFile = Template.currentData();
    const writtenOfferEnabled = event.target.checked;
    updateSbomFile({
      '$set':{
        'writtenOfferEnabled': writtenOfferEnabled
      }
    },sbomFile, {_id: sbomFile._id});
  },
  'click .change_view': function () {
    Session.set('showAll', !Session.get('showAll'));
  },
  'click .show_unknown_license_details': function () {
    Session.set('noticeShowUnknownLicense', !Session.get('noticeShowUnknownLicense'));
  },

  // eslint-disable-next-line sonarjs/cognitive-complexity
  'click .save_component': function (event) {
    event.preventDefault();
    const templateData = Template.currentData();
    event.preventDefault();
    let form = $(event.target).closest('.edit_component');
    const sbomFile = templateData;
    let componentObject = this;
    const componentUpdates = {
      component: _.clone(componentObject),
      updates: {},
      moduleId: componentObject.moduleIds && componentObject.moduleIds[0],
      projectId: sbomFile.projectId
    };
    const nameInput = form.find('[name=name]');
    if(nameInput){
      let value = nameInput.val();
      if(componentObject.name !== value){
        componentUpdates.updates['name'] = value;
        componentObject.name = value;
      }
    }
    const versionInput = form.find('[name=version]');
    if(versionInput){
      let value = versionInput.val();
      if(componentObject.version !== value){
        componentUpdates.updates['version'] = value;
        componentObject.version = value;
      }
    }
    const copyrightTextInput = form.find('[name=copyrightText]');
    if(copyrightTextInput){
      let value = copyrightTextInput.val();
      if(componentObject.copyrightText !== value){
        componentUpdates.updates['copyrightText'] = value;
        componentObject.copyrightText = value;
      }
    }
    const licenseKeyInput = form.find('[name=licenseKey]');
    if(licenseKeyInput){
      let value = licenseKeyInput.val();
      if(componentObject.licenseKey !== value){
        componentUpdates.updates['licenseKey'] = value;
        componentObject.licenseKey = value;
      }
    }
    const licenseInput = form.find('[name=license]');
    if(licenseInput){
      let value = licenseInput.val();
      if(componentObject.license !== value){
        componentUpdates.updates['license'] = value;
        componentObject.license = value;
      }
    }
    const packageFileNameInput = form.find('[name=packageFileName]');
    if(packageFileNameInput){
      let value = packageFileNameInput.val();
      if(componentObject.packageFileName !== value){
        componentUpdates.updates['packageFileName'] = value;
        componentObject.packageFileName = value;
      }
    }
    const summaryInput = form.find('[name=summary]');
    if(summaryInput){
      let value = summaryInput.val();
      if(componentObject.summary !== value){
        componentUpdates.updates['summary'] = value;
        componentObject.summary = value;
      }
    }
    const sourceInfoInput = form.find('[name=sourceInfo]');
    if(sourceInfoInput){
      let value = sourceInfoInput.val();
      if(componentObject.sourceInfo !== value){
        componentUpdates.updates['sourceInfo'] = value;
        componentObject.sourceInfo = value;
      }
    }
    const originatorInput = form.find('[name=originator]');
    if(originatorInput){
      let value = originatorInput.val();
      if(componentObject.originator !== value){
        componentUpdates.updates['originator'] = value;
        componentObject.originator = value;
      }
    }
    const supplierInput = form.find('[name=supplier]');
    if(supplierInput){
      let value = supplierInput.val();
      if(componentObject.supplier !== value){
        componentUpdates.updates['supplier'] = value;
        componentObject.supplier = value;
      }
    }
    const downloadLocationInput = form.find('[name=downloadLocation]');
    if(downloadLocationInput){
      let value = downloadLocationInput.val();
      if(componentObject.downloadLocation !== value){
        componentUpdates.updates['downloadLocation'] = value;
        componentObject.downloadLocation = value;
      }
    }
    const homepageUrlInput = form.find('[name=homepageUrl]');
    if(homepageUrlInput){
      let value = homepageUrlInput.val();
      if(componentObject.homepageUrl !== value){
        componentUpdates.updates['homepageUrl'] = value;
        componentObject.homepageUrl = value;
      }
    }
    const repoUrlInput = form.find('[name=repoUrl]');
    if(repoUrlInput){
      let value = repoUrlInput.val();
      if(componentObject.repoUrl !== value){
        componentUpdates.updates['repoUrl'] = value;
        componentObject.repoUrl = value;
      }
    }
    const hashOfExecutableInput = form.find('[name=hashOfExecutable]');
    if(hashOfExecutableInput){
      let value = hashOfExecutableInput.val();
      if(componentObject.hashOfExecutable !== value){
        componentUpdates.updates['hashOfExecutable'] = value;
        componentObject.hashOfExecutable = value;
      }
    }
    const hashOfSourceInput = form.find('[name=hashOfSource]');
    if(hashOfSourceInput){
      let value = hashOfSourceInput.val();
      if(componentObject.hashOfSource !== value){
        componentUpdates.updates['hashOfSource'] = value;
        componentObject.hashOfSource = value;
      }
    }
    const sourceUrlInput = form.find('[name=sourceUrl]');
    if(sourceUrlInput){
      let value = sourceUrlInput.val();
      if(componentObject.sourceUrl !== value){
        componentUpdates.updates['sourceUrl'] = value;
        componentObject.sourceUrl = value;
      }
    }
    const binaryUrlInput = form.find('[name=binaryUrl]');
    if(binaryUrlInput){
      let value = binaryUrlInput.val();
      if(componentObject.binaryUrl !== value){
        componentUpdates.updates['binaryUrl'] = value;
        componentObject.binaryUrl = value;
      }
    }
    const otherInput = form.find('[name=other]');
    if(otherInput){
      let value = otherInput.val();
      if(componentObject.other !== value){
        componentUpdates.updates['other'] = value;
        componentObject.other = value;
      }
    }
    updateSbomFile({
      '$set':{
        'list.$': componentObject
      }
    },sbomFile, {_id: sbomFile._id, list: {
      $elemMatch:{
        key: componentObject && componentObject.key
      }}
    }, componentUpdates);
  }
});

Template.sbomFileDetails.helpers({
  sbomFile: function () {
    const sbomFile = Template.currentData();
    processChartProgress(sbomFile);
    return sbomFile
  },

  pagedList: function () {
    const sbomFile = Template.currentData();
    const instance = Template.instance();
    if (!sbomFile || !sbomFile.list) return [];
    const page = instance.currentPage.get();
    const start = page * PAGE_SIZE;
    return sbomFile.list.slice(start, start + PAGE_SIZE);
  },

  paginationInfo: function () {
    const sbomFile = Template.currentData();
    const instance = Template.instance();
    if (!sbomFile || !sbomFile.list || sbomFile.list.length <= PAGE_SIZE) return null;
    const total = sbomFile.list.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const current = instance.currentPage.get();
    return {
      current: current,
      currentDisplay: current + 1,
      totalPages: totalPages,
      total: total,
      pageSize: PAGE_SIZE,
      hasPrev: current > 0,
      hasNext: current < totalPages - 1
    };
  },
  getSbomFile: function () {
    let sbomFile = Template.currentData();
    if (!sbomFile.licenses){
      sbomFile = Template.parentData();
      if (!sbomFile.licenses){
        sbomFile = Template.parentData(2);
      }
    }
    return sbomFile
  },
  updateSbomFile: function () {
    return updateSbomFile;
  },

  isUnknown: function () {
    return this.key === 'unknown'
  },

  getUrl: function (type) {
    const urls = (this && this.urls) || {};
    return urls[type];
  },
  getField: function (field) {
    const data = this || {};
    return data[field];
  },

  missingData: function () {
    return this.getName && this.getName() && this.getName().indexOf(' is N.A.') > -1
  },

  showDetails: function () {
    let license = this;
    let details = Session.get('showDetails') || [];
    return _.any(details,function (item) {
      return item === getOptimizedLicenseKey(license.key)
    })
  },

  showDetailsTree: function () {
    let license = this;
    let details = Session.get('showDetailsTree') || [];
    return _.any(details,function (item) {
      return item === getOptimizedLicenseKey(license.key)
    })
  },

  getOptimizedKey: function () {
    return getOptimizedLicenseKey(this.key)
  },

  isCompleted: function () {
    return this.completed ? 'checked' : ''
  },

  isWrittenOfferEnabled: function () {
    return this.writtenOfferEnabled ? 'checked' : ''
  },

  isEnabled: function () {
    return !this.disabled ? 'checked' : false
  },

  getUUID: function () {
    return uuid.v4();
  },

  reportProgress: function () {
    return uuid.v4();
  },

  todosRemaining: function () {
    return this.totalActivity - this.completedActivity
  },

  reportDisabled: function () {
    let sbomFile = Template.currentData();
    if (!sbomFile.licenses){
      sbomFile = Template.parentData();
      if (!sbomFile.licenses){
        sbomFile = Template.parentData(2);
      }
    }
    return sbomFile.disabled ? 'disabled' : false
  },

  hasUnknownLicenseComponents: function () {
    return this.unknownLicenseComponents && this.unknownLicenseComponents.length
  },

  showNotice: function () {
    return Session.get('noticeShowUnknownLicense');
  },

  showAll: function () {
    return Session.get('showAll');
  },

  visibilityClass: function () {
    let item = this;
    let showAll = Session.get('showAll');
    if(item.list){
      let completed = _.all(item.list,(comp)=>{
        return comp.completed
      })
      return completed && item.completed && !showAll ? 'hidden' : ''
    }else{
      return item.completed && !showAll ? 'hidden' : ''
    }
  }
});
