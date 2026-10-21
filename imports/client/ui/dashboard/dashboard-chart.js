import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Chart from 'chart.js';
import 'chart.piecelabel.js';

/**
 * Overwrite Chart.js globals
 *
 *
 */
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

async function renderLicenseChart() {
  let chart = $('.doughnut-chart');
  chart.empty();
  chart.append('<canvas id="applied-license-chart" height="150"></canvas>');
  let canvas = $('#applied-license-chart').get(0);
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
    legend: {
      display: true,
      position: 'right'
    },
    plugins: {
      datalabels: {
        display: false
      }
    },
    onAnimationComplete: fillDoughnut,
    customTooltips: function (tooltip) {
      Chart.helpers._drawTooltip(ctx, tooltip, fillDoughnut);
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

  async function fillDoughnut() {
    const ctx = canvas.getContext('2d');
    try {
      const result = await Meteor.callAsync('getTotalLicensesAndComponents');
      const licText = '' + result.licenses + ' Licenses';
      const compText = '' + result.components + ' Components';
      ctx.font = '12px Open Sans';
      ctx.fillStyle = 'black';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(licText, parseInt(canvas.style.width) / 2, parseInt(canvas.style.height) / 2 - 10);
      ctx.fillText(compText, parseInt(canvas.style.width) / 2, parseInt(canvas.style.height) / 2 + 10);
    } catch (error) {
      console.error(error);
    }
  }

  try {
    const result = await Meteor.callAsync('getLicenseStatistics', Session.get('currentProject'));
    if(result && result.datasets[0] && result.labels.length === 0){
      chart.empty();
      chart.append('<h4 style="height:213px; line-height:213px; display:block; text-align: center">No data available for this chart</h4>');
    }else{
      new Chart(ctx, {
        type: 'pie',
        data: result,
        options: options
      });
    }
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_error) {
    chart.empty();
    chart.append('<h4 style="height:213px; line-height:213px; display:block; text-align: center">No data available for this chart</h4>');
  }
}

async function renderModuleChart() {

  let chart = $('.bar-chart');
  chart.empty();
  chart.append('<canvas id="modules-overview-chart" height="150"></canvas>');
  let canvas = $('#modules-overview-chart').get(0);
  const ctx = canvas.getContext('2d');

  const options = {
    responsive: true,
    barShowStroke: false,
    multiTooltipTemplate: '<%= datasetLabel %>: <%= value %>'
  };

  try {
    const result = await Meteor.callAsync('getModulesChartData');
    const chartJs = new Chart(ctx, {
      type: 'bar',
      data: result,
      options: options
    });

    $(canvas).click(evt => {
      const activeBars = chartJs.getElementAtEvent(evt);
      if (activeBars && activeBars.length) {
        let index = _.indexOf(result.labels, activeBars[0].label);
        if (index >= 0) {
          Router.go('moduleLicenses', {moduleId: result.ids[index]});
        }
      }
    });
  } catch (error) {
    console.error(error);
  }
}

Template.dashboardChart.onRendered(function () {
  renderLicenseChart();

  renderModuleChart();
});

Template.dashboardChart.events({
  'change #currentProject': function (event) {
    const _id = $(event.target).val();
    Session.set('currentProject',_id);
    renderLicenseChart()
  }
});

Template.dashboardChart.helpers({
  projects: function () {
    return Projects.find().fetch()
  },
  isCurrentProject: function (_id) {
    return Session.get('currentProject') === _id
  }
});
