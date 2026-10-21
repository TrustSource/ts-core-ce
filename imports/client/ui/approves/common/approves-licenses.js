import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import Projects from '/imports/lib/collections/projects';
import reportLicensesService from '/imports/lib/reports/reportLicensesService';
import ApprovalReports from '/imports/lib/collections/approvalReports';
import Chart from 'chart.js';
import 'chart.piecelabel.js';

Chart.defaults.global.responsive = true;
Chart.defaults.global.scaleFontFamily = '\'Open Sans\', \'Helvetica Neue\', \'Helvetica\', \'Arial\', sans-serif';
Chart.defaults.global.tooltipFontSize = 10;
Chart.defaults.global.tooltipTitleFontSize = 12;
Chart.defaults.global.tooltipTitleFontStyle = 'normal';
Chart.defaults.global.tooltipFontStyle = 'normal';
Chart.defaults.global.tooltipFontFamily = Chart.defaults.global.scaleFontFamily;
Chart.defaults.global.tooltipTitleFontFamily = Chart.defaults.global.scaleFontFamily;

function hexToRgb(hex) {
  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  let shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, function (m, r, g, b) {
    return r + r + g + g + b + b;
  });

  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getModuleIds(approval) {
  return _.map(approval.modules,function (module) {
    return module._id
  });
}

function renderLicenseChart(approve) {
  let chart = $('.doughnut-chart');
  chart.empty();
  chart.append('<canvas id="applied-license-chart" height="150"></canvas>');
  let canvas = $('#applied-license-chart').get(0);
  if(canvas){
    const ctx = canvas.getContext('2d');

    const options = {
      segmentShowStroke: true,
      segmentStrokeColor: '#fff',
      segmentStrokeWidth: 2,
      percentageInnerCutout: 0, // This is 0 for Pie charts
      animationSteps: 100,
      animationEasing: 'easeOutBounce',
      animateRotate: true,
      animateScale: false,
      responsive: true,
      plugins: {
        legend: {
          title: {
            display: true,
            text: 'Hover the diagram for details'
          }
        },
        datalabels: {
          display: false
        }
      },
      legend: {
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Hover the diagram for details'
        }
      },
      pieceLabel: {
        overlap: false,
        color: '#000',
        render: 'percentage',
        fontColor: function (data) {
          let rgb = hexToRgb(data.dataset.backgroundColor[data.index]);
          let threshold = 140;
          let luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
          return luminance > threshold ? 'black' : 'white';
        },
        precision: 0
      }
    };

    let legal = ApprovalReports.findOne({type:'legal',approveId:approve._id});
    if(!legal){
      let {projectId, modules} = approve
      const moduleIds = getModuleIds(approve)
      Meteor.callAsync('getLicenseStatistics', projectId, moduleIds, modules).then(function(data) {
        if(!data || (data && data.datasets[0] && data.labels.length === 0)){
          chart.empty();
          chart.append('<h4 style="height:213px; line-height:213px; display:block; text-align: center">' +
            'No data available for this chart</h4>');
        }else{
          new Chart(ctx, {
            type: 'pie',
            data: data,
            options: options
          });
        }
      }).catch(function(error) {
        console.error('getLicenseStatistics failed:', error);
      });
    }else{
      let legalData = legal && legal.data
      if(!legalData || (legalData && legalData.datasets[0] && legalData.labels.length === 0)){
        chart.empty();
        chart.append('<h4 style="height:213px; line-height:213px; display:block; text-align: center">' +
          'No data available for this chart</h4>');
      }else{
        new Chart(ctx, {
          type: 'pie',
          data: legalData,
          options: options
        });
      }
    }
  }
}

Template.approvesLicenses.events({
  'click .section-expand': function (event) {
    const section = $(event.target).closest('.panel');
    const content = section.children('.panel-body');
    content.slideToggle(300)
    section.find('.panel-heading .fa').first().toggleClass('fa-chevron-up fa-chevron-down')
  }
});

Template.approvesLicenses.helpers({
  projectId: function () {
    const approve = this;
    return approve && approve.projectId;
  },
  getModuleId: function () {
    const approve = this;
    let reportModules = approve.getModuleIds();
    return reportModules.length === 1 ? reportModules[0] : false ;
  },
  haveDescription: function (description) {
    return description && description.length > 0
  },
  getProjectLicenses:function () {
    const approve = this;
    Session.set('requestInProgress', true);
    Session.set('reportProjectLicenses');
    let getList = ApprovalReports.findOne({type:'licenses',approveId:approve._id});
    Session.set('reportProjectLicenses', getList && getList.data);
    Session.set('requestInProgress', false);
    Meteor.setTimeout(function (){
      renderLicenseChart(approve);
    },1)
    if(getList){
      return getList.data.list
    }else{
      let {projectId, companyId, modules} = approve
      const moduleIds = getModuleIds(approve)
      let getList = ReactiveMethod.call('getProjectLicenses', projectId, companyId, moduleIds, modules);
      Session.set('reportProjectLicenses', getList);
      Session.set('requestInProgress', false);
      if(getList){
        return getList.list
      }else{
        return []
      }
    }
  },
  getProjectLicensesStatus: function () {
    return Session.get('reportProjectLicenses');
  },
  getDeadlyObligations: function () {
    return this.deadlyObligations
  },
  getPluralized: function (text,list) {
    return reportLicensesService.getPluralized(text, list.length || list)
  },
  counterLicenses: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return projectLicenses && projectLicenses.stats.licenses
  },
  counterComponents: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return projectLicenses && projectLicenses.stats.components
  },
  counterObligations: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return projectLicenses && projectLicenses.stats.obligations
  },
  getProjectLicensesOkStatus: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return _.filter(projectLicenses.list, function (license) {
      return license.status === 'ok'
    });
  },
  getProjectLicensesWarningsStatus: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return _.filter(projectLicenses.list, function (license) {
      return license.status === 'warnings'
    });
  },
  getProjectLicensesViolationsStatus: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return _.filter(projectLicenses.list, function (license) {
      return license.status === 'violations'
    });
  },
  getProjectLicensesOkCount: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return _.filter(projectLicenses.list, function (license) {
      return license.status === 'ok'
    }).length;
  },
  getProjectLicensesWarningsCount: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return _.filter(projectLicenses.list, function (license) {
      return license.status === 'warnings'
    }).length;
  },
  getProjectLicensesViolationsCount: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return _.filter(projectLicenses.list, function (license) {
      return license.status === 'violations'
    }).length;
  },
  getPercent: function (counter) {
    const projectLicenses = Session.get('reportProjectLicenses');
    return Math.round((+counter/projectLicenses.list.length) * 100)
  },
  describeObligations: function () {
    return reportLicensesService.describeObligations(this.toString())
  },
  describeDeadlyObligations: function () {
    return reportLicensesService.describeDeadlyObligations(this.toString())
  },
  describeViolations: function () {
    return reportLicensesService.describeViolations(this.toString())
  },
  noDataInProject: function () {
    const projectLicenses = Session.get('reportProjectLicenses');
    return projectLicenses && projectLicenses.list && projectLicenses.list.length === 0
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  },
  getRequirements: function () {
    const approve = this;
    let project =  Projects.findOne(approve.projectId);
    return (project) ? project.requirements : false
  },
  actionRoute: function () {
    const path = this;
    let approve = Template.parentData(3);
    if(!approve.projectId){
      approve = Template.parentData(4);
    }
    const module = _.find(approve.modules, function (moduleData) {
      return path.module && moduleData._id === path.module._id
    });
    let route = {
      route: 'moduleDependencies',
      params: {
        projectId: approve.projectId || Projects.UNASSIGNED,
        moduleId: path.module._id
      }
    };
    if(!route.query){
      route.query = {};
    }
    if(module && module.analysisId){
      route.query.analysis = module.analysisId;
    }
    return route
  }
});
