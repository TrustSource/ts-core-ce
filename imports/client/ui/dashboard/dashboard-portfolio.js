/* global window:false, document:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Chart from 'chart.js';
import 'chartjs-chart-treemap';

Template.dashboardPortfolio.onRendered(function () {
  Session.set('portfolioChartProjectName')
  Session.set('portfolioChartProjectId')
  Session.set('portfolioChartSlotSizeDefinedBy', 'components')
  Session.set('portfolioChartStatusDefinedBy', 'summary')
  renderLicenseChart()
});

async function renderLicenseChart() {
  let chart = $('.portfolio-chart');
  chart.empty();
  chart.append('<canvas id="portfolio-chart" height="150"></canvas>');
  let canvas = $('#portfolio-chart').get(0);
  const ctx = canvas.getContext('2d');

   
  try {
    const result = await Meteor.callAsync('getPortfolioOverview', Session.get('portfolioChartProjectId'));
    if(!result){
      chart.empty();
      chart.append('<h4 style="height:213px; line-height:213px; display:block; text-align: center">No data available for this chart</h4>');
    }else{
      const slotSizeDefinedBy = Session.get('portfolioChartSlotSizeDefinedBy') || 'components' // 'components', 'licenses'
      const statusDefinedBy = Session.get('portfolioChartStatusDefinedBy') || 'summary'
      // 'summary', 'integrity', 'legal', 'versioning', 'viability', 'vulnerability'
      const projectId = Session.get('portfolioChartProjectId') // 'Z3mSNWpZtRe99qnCG'
      const filterResults = function (result, projectId){
        return projectId ? result.filter(function (item){
          return item.projectId === projectId
        }) : result
      }
      const getScoreColor = function (violations, warnings){
        if(violations) {
          return '#cf4747'
        }else if(warnings){
          return '#feba49'
        }
        return '#2a94a2'
      }
      const getScoreProjectColor = function (children, statusDefinedBy){
        if(_.some(children, function(child){
          return child.stats && child.stats[statusDefinedBy] && child.stats[statusDefinedBy].violations
        })){
          return '#cf4747'
        }else if(_.some(children, function(child){
          return child.stats && child.stats[statusDefinedBy] && child.stats[statusDefinedBy].warnings
        })){
          return '#feba49'
        }
        return '#2a94a2'
      }
      const getGroups = function (result, projectId){
        const defaultGroups = result.length > 100 ? ['project'] : ['project', 'title'];
        return projectId ? ['title'] : defaultGroups
      }
      const portfolioChart = new Chart(ctx, {
        type: 'treemap',
        data: {
          datasets: [{
            tree: filterResults(result, projectId),
            key: slotSizeDefinedBy,
            groups: getGroups(result, projectId),
            fontColor: '#ffffff',
            backgroundColor: function(ctx) {
              const value = ctx.dataset.data[ctx.dataIndex]
              const isModule = value && value._data && value._data.title
              const children = value && value._data && value._data.children
              if(isModule){
                const stats = children && children[0] && children[0].stats
                return getScoreColor(stats && stats[statusDefinedBy] && stats[statusDefinedBy].violations,
                  stats && stats[statusDefinedBy] && stats[statusDefinedBy].warnings)
              }else{
                return getScoreProjectColor(children, statusDefinedBy)
              }
            },
            fontSize: 14,
            spacing: 2,
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.7)'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          legend: {
            display: false
          },
          plugins: {
            datalabels: {
              display: false
            }
          },
          tooltips: {
            callbacks: {
              title: function(item, data) {
                return data.datasets[item[0].datasetIndex].key
              },
              label: function(item, data) {
                const dataset = data.datasets[item.datasetIndex];
                const dataItem = dataset.data[item.index];
                const obj = dataItem._data;
                const label = obj.title || obj.project;
                const stats = obj.title ? obj.children && obj.children[0] && obj.children[0].stats : false;
                return label + ':  ' + obj[dataset.key] + (!stats ? '' :
                  ` | ${statusDefinedBy} = violations: ${stats[statusDefinedBy].violations} warnings: ${stats[statusDefinedBy].warnings}`) ;
              }
            }
          },
          customTooltips: function (tooltip) {
            Chart.helpers._drawTooltip(ctx, tooltip);
          }
        }
      });
      document.getElementById('portfolio-chart').onclick = function(evt) {
        const points = portfolioChart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
        const firstPoint = points && points[0];
        if (firstPoint !== undefined) {
          const value = portfolioChart.data.datasets[firstPoint._datasetIndex].data[firstPoint._index];
          const isModule = value && value._data && value._data.title
          const children = value && value._data && value._data.children[0]
          if(isModule){
            window.open(Router.url('moduleDependencies', {moduleId: children._id, projectId: children.projectId}));
          }else{
            Session.set('portfolioChartProjectName', children.project)
            Session.set('portfolioChartProjectId', children.projectId)
            renderLicenseChart();
          }
        }
      };
    }
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_error) {
    chart.empty();
    chart.append('<h4 style="height:213px; line-height:213px; display:block; text-align: center">No data available for this chart</h4>');
  }
}

Template.dashboardPortfolio.helpers({
  isProjectSpecific: function () {
    return Session.get('portfolioChartProjectId');
  },
  getProjectSpecificName: function () {
    return Session.get('portfolioChartProjectName');
  },
  isEmpty: function () {
    const company = Session.get('company');
    const stats = company && company.statistics && company.statistics[company.statistics.length - 1];
    const total = (stats && stats.modules && stats.modules.total) || 0;
    return total < 2;
  }
});

Template.dashboardPortfolio.events({
  'click .reset-project': function () {
    Session.set('portfolioChartProjectId')
    Session.set('portfolioChartProjectName')
    renderLicenseChart()
  },
  'change .change-view': function (event) {
    const newValue = $(event.target).find(':selected').val();
    const parts = newValue.split('-')
    Session.set('portfolioChartStatusDefinedBy', parts[1])
    Session.set('portfolioChartSlotSizeDefinedBy', parts[0])
    renderLicenseChart()
  }
});
