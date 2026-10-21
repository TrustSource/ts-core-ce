/* global window:false, document:false, Blob:false, performance:false, swal: false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import uuid from 'uuid';
import Notify from '/imports/api/notify';
import pdfMake from 'pdfmake/build/pdfmake.js';
import 'pdfmake/build/vfs_fonts.js';
import reportNoticeFileService from '/imports/lib/reports/reportNoticeFileService';

const NOTICE_LEFT = '.notice-view-left'
const NF = '-notice-file-'

Template.noticeFileDetails.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  Session.set('showDetails');
  Session.set('showDetailsTree');
  Session.set('noticeShowUnknownLicense');
  Session.set('showAll', true)
});

Template.noticeFileDetails.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

function getOptimizedLicenseKey(key) {
  if (key && typeof key === 'object') key = key.name || key.key || JSON.stringify(key);
  return key && typeof key === 'string' && key.split(/[.#:@/() ]/).join('') || 'unknown'
}

function processChartProgress(data) {
  const options = {
    type: 'pie',
    width: '80px',
    height: '80px',
    sliceColors: [
      '#2a94a2',
      '#eeeeee'
    ],
    offset: -90
  };
  if(data){
    const chartData = [data.completedActivity, data.totalActivity-data.completedActivity];
    Meteor.setTimeout(function () {
      $('#chart-progress-modules').sparkline(chartData, options);
    },1)
  }
}

function updateNoticeFile(modifier, noticeFile, filter, componentUpdates) {
  const user = Meteor.user();
  const fullData = Session.get('FullData')
  if(noticeFile && fullData){
    let logName = noticeFile.getName();
    let completedActivity = 0;
    let componentsCount = 0;
    _.each(fullData.licenses, function (license) {
      componentsCount = componentsCount + license.components.length;
      if (license.completed) {
        completedActivity = completedActivity + 1
      }
      _.each(license.components, function (component) {
        if(component.completed) {
          completedActivity = completedActivity + 1
        }
      });
    });
    const totalActivity = (componentsCount || 0) + (fullData.licenses.length || 0);
    modifier['$set'].totalActivity = totalActivity;
    modifier['$set'].completedActivity = completedActivity;
    modifier['$set'].completed = completedActivity && totalActivity ? Math.round((completedActivity/totalActivity) * 100) : 0;
    let listUpdates = modifier['$set']['licenses.$']
    if(listUpdates && listUpdates.key){
      fullData.licenses = fullData.licenses.map((license) => {
        if(license.key === listUpdates.key){
          license = listUpdates
        }
        return license
      })
    }
    Session.set('FullData',fullData)
    Meteor.callAsync(
      'NoticeFiles.Update',
      modifier,
      noticeFile._id,
      filter,
      componentUpdates,
      fullData
    ).then(function(result) {
      if (!result) {
        let textError = 'Error: could not update notice file';
        Meteor.callAsync('logEvent', user, textError, 'noticeFileUpdated');
        Notify.danger(textError);
      } else {
        Notify.success('Notice file updated!');
        Meteor.callAsync('logEvent', user, 'Notice file '+logName+' updated', 'noticeFileUpdated');
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

Template.noticeFileDetails.events({

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
    const noticeFile = Template.currentData();
    const fullData = Session.get('FullData');
    let licenseObject;
    const completed = event.target.checked;
    const element = this;
    element.completed = completed;
    const license = $(event.target).closest('.panel_with_license').attr('data-license-key');
    if(element.version){
      const component = $(event.target).closest('.panel_with_component').attr('data-component-key');
      licenseObject = _.find(fullData.licenses, function (licenseItem) {
        return getOptimizedLicenseKey(licenseItem.key) === license
      });
      let componentObject = _.find(licenseObject.components, function (componentItem) {
        return getOptimizedLicenseKey(componentItem.key) === component
      });
      if(componentObject){
        componentObject.completed = completed
      }
    }
    updateNoticeFile({
      '$set':{
        'licenses.$': licenseObject || element
      }
    },noticeFile, {_id: noticeFile._id, licenses: {
      $elemMatch:{
        key: licenseObject && licenseObject.key || element.key
      }}
    });
  },

  'click .scroll_to_section': function (event) {
    event.preventDefault();
    const link = this;
    const license = $(event.target).closest('.panel_with_license').attr('data-license-key');
    if(link.version){
      const component = $(event.target).closest('.panel_with_component').attr('data-component-key');
      scrollToElm(NOTICE_LEFT, '.panel-'+license+' .panel-'+component , 600 );
    }else{
      scrollToElm(NOTICE_LEFT, '.panel-'+license , 600 );
    }
  },

  'click .freeze_version': function (event) {
    event.preventDefault();
    const noticeFile = this;
    let logName = noticeFile.getName();
    swal({
      title: 'Are you sure you want to freeze notice file ' + logName + '?',
      text: 'You will not be able to change frozen notice file, but copy of it will be created with increased version!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, freeze it!'
    }, function () {
      Meteor.callAsync('NoticeFiles.Freeze', noticeFile._id).then(function() {
        const user = Meteor.user();
        let textSuccess = 'Notice file '+logName+' has been frozen';
        Meteor.callAsync('logEvent', user, textSuccess, 'noticeFileFreeze');
        Notify.success(textSuccess);
      }).catch(function(error) {
        const user = Meteor.user();
        let textError = 'Error: ' + (error.reason || ' could not freeze notice file');
        Meteor.callAsync('logEvent', user, textError, 'noticeFileFreeze');
        Notify.danger(textError);
      });
    });
  },

  'click .export_as_pdf_report': function () {
    let reportData = this;
    let report = reportNoticeFileService.getPdfDetails(reportData);
    try{
      pdfMake.createPdf(report).download(reportData.getName()+NF+reportData.version+'.pdf')
    }catch (error){
      if(error.indexOf('invalid image') > -1){
        Notify.danger('Please check the logo URL at [Settings > General info]. We were not able to retrieve a valid logo file.');
      }else{
        Notify.danger(error);
      }
    }
  },

  'click .export_as_txt_report': function () {
    let reportData = this;
    let report = reportNoticeFileService.getMDasTxtDetails(reportData);
    let blob = new Blob([report]);
    if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
      window.navigator.msSaveBlob(blob, reportData.getName()+NF+reportData.version+'.txt');
    else
    {
      let a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(blob, {type: 'text/plain'});
      a.download = reportData.getName()+NF+reportData.version+'.txt';
      document.body.appendChild(a);
      a.click();  // IE: "Access is denied";
      // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
      document.body.removeChild(a);
    }
  },

  'change .on_writtenOfferEnabled': function (event) {
    event.preventDefault();
    const noticeFile = Template.currentData();
    const writtenOfferEnabled = event.target.checked;
    updateNoticeFile({
      '$set':{
        'writtenOfferEnabled': writtenOfferEnabled
      }
    },noticeFile, {_id: noticeFile._id});
  },

  'click .change_view': function () {
    Session.set('showAll', !Session.get('showAll'));
  },

  'click .show_unknown_license_details': function () {
    Session.set('noticeShowUnknownLicense', !Session.get('noticeShowUnknownLicense'));
  }
});

Template.noticeFileDetails.helpers({
  noticeFile: function () {
    const noticeFile = Template.currentData();
    processChartProgress(noticeFile);
    return noticeFile
  },
  noticeFileDetails: function () {
    const noticeFile = Template.currentData();
    let fullData = Session.get('FullData')
    if(noticeFile && (!fullData || (fullData && fullData._id !== noticeFile._id))){
      fullData = ReactiveMethod.call('NoticeFiles.FindOne', noticeFile._id)
      Session.set('FullData',fullData)
    }
    if(fullData){
      noticeFile.licenses = Array.isArray(fullData.licenses) ? fullData.licenses : []
      if (noticeFile.licenses) {
        noticeFile.licenses = noticeFile.licenses.map(function (license) {
          if (license.components && !Array.isArray(license.components)) {
            license.components = [];
          }
          return license;
        });
      }
      if (fullData.unknownLicenseComponents && !Array.isArray(fullData.unknownLicenseComponents)) {
        fullData.unknownLicenseComponents = [];
      }
      noticeFile.unknownLicenseComponents = fullData.unknownLicenseComponents;
    }
    return fullData && fullData._id && noticeFile ? noticeFile : null
  },

  getNoticeFile: function () {
    let noticeFile = Template.currentData();
    if (!noticeFile.licenses){
      noticeFile = Template.parentData();
      if (!noticeFile.licenses){
        noticeFile = Template.parentData(2);
      }
    }
    const fullData = Session.get('FullData')
    if(fullData){
      noticeFile.licenses = fullData.licenses
    }
    return noticeFile
  },
  updateNoticeFile: function () {
    return updateNoticeFile;
  },

  isUnknown: function () {
    return this.key === 'unknown'
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
    let noticeFile = Template.currentData();
    if (!noticeFile.licenses){
      noticeFile = Template.parentData();
      if (!noticeFile.licenses){
        noticeFile = Template.parentData(2);
      }
    }
    return noticeFile.disabled ? 'disabled' : false
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
    if(item.components){
      let completed = _.all(item.components,(comp)=>{
        return comp.completed
      })
      return completed && item.completed && !showAll ? 'hidden' : ''
    }else{
      return item.completed && !showAll ? 'hidden' : ''
    }
  },

  getSearchParams: function () {
    return {
      key: this.key
    }
  },

  componentName: function () {
    return this.name || this.key
  }
});
