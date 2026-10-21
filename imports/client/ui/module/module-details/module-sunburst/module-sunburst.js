/* global document:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Chart from 'chart.js';
import 'chartjs-chart-sunburst-extend';

Template.moduleSunburst.onRendered(function () {
  renderChart()
});

 
function traverse(obj, parent, components, root, index) {
  if (Array.isArray(obj)){
    _.each(obj, function (val) {
      traverse(val, parent, components, root, index);
    });
  }else if (obj){
    let matchedComponent = _.find(components, function (Component) {
      return Component.getKey() === obj.key
    });
    const status = matchedComponent && matchedComponent.status;
    const bgWarningOrOk = status === 'warnings' ? 'rgba(254, 186, 73, 1)' : 'rgba(42, 148, 162, 1)';
    let element = {
      name:obj.name,
      key:obj.key,
      version:obj.versions && obj.versions[0],
      license:obj.licenses && obj.licenses[0] && obj.licenses[0].name,
      children: [],
      status,
      childrenStatus: 'ok',
      backgroundColor: status === 'violations' ? 'rgba(207, 71, 71, 1)' : bgWarningOrOk,
      borderColor: 'rgba(255,255,255,0.5)',
      dependencies: obj.dependencies && obj.dependencies.length,
      value: obj.dependencies && obj.dependencies.length || 1,
      parentId: parent && parent.id || 'root',
      id:`${obj.key}___${obj.versions && obj.versions[0] || ''}___${parent.id || 'root'}___${index || 0}`
    };
    _.each(obj.dependencies, function (val, index) {
      traverse(val, element, components, root, index);
    });
    if(element.dependencies > 1){
      element.borderWidth = 2
    }
    if(element.childrenStatus === 'warnings' || element.childrenStatus === 'violations'){
      const borderWarningOrDefault = element.childrenStatus === 'warnings' ? 'rgb(206,157,47)' : 'rgba(255, 255, 255, 1)';
      element.borderColor = element.childrenStatus === 'violations' ? 'rgb(187,50,50)' : borderWarningOrDefault
    }
    if (parent && parent.children){
      if(element.status === 'violations' || element.childrenStatus === 'violations'){
        parent.childrenStatus = 'violations'
      }
      if(((element.status === 'warnings' || element.childrenStatus === 'warnings') && parent.childrenStatus !== 'violations')){
        parent.childrenStatus = 'warnings'
      }
      parent.children.push(element);
    }else if(Array.isArray(parent)){
      parent.push(element);
    }
    if(parent && parent.dependencies){
      parent.value += +element.value
      parent.dependencies += +element.dependencies
    }
    root.push(element);
  }
}

 
function renderChart() {
  let chart = $('.sunburst-chart');
  chart.empty();
  chart.append('<canvas id="sunburst-chart" height="150"></canvas>');
  let canvas = $('#sunburst-chart').get(0);
  const ctx = canvas.getContext('2d');
  const templateData = Template.parentData(0);
  let components = templateData && templateData.collection;
  if(components && components.length){
    Meteor.callAsync(
      'getLastModuleScan',
      Router.current().params.moduleId,
      Router.current().params.query.analysis
    ).then(function(data) {
      if(!data){
        chart.empty();
        chart.append('<h4 style="height:213px; line-height:213px; display:block; text-align: center">' +
          'No scan found for this chart</h4>');
      }else{
        let jsonData = [];
        let root = [{ parentId: null, id: 'root', value: 1 }];
        traverse(data.dependencies, jsonData, components, root);
        Session.set('toManyItemsHint',(jsonData.length > 150));
        const portfolioChart = new Chart(ctx, {
          type: 'sunburst',
          data: {
            datasets: [{
              data: root,
              borderWidth: 1,
              borderAlign: 'inner'
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
                  const dataset = data.datasets[item[0].datasetIndex];
                  const dataItem = dataset.data[item[0].index];
                  const version = dataItem.version ? ` (${dataItem.version})` : ' '
                  const license = dataItem.license ? ` [${dataItem.license}]` : ' '
                  const dependencies = dataItem.dependencies ? `: ${dataItem.dependencies} dependencies` : ' '
                  return `${dataItem.name}${version}${license}${dependencies}`
                },
                label: function() {
                  return false
                }
              }
            },
            customTooltips: function (tooltip) {
              Chart.helpers._drawTooltip(ctx, tooltip);
            },
            scaleByMetric: 'value'
          }
        });
        if(document.getElementById('sunburst-chart')){
          document.getElementById('sunburst-chart').onclick = function(evt) {
            const points = portfolioChart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
            const firstPoint = points && points[0];
            let rootId = portfolioChart.options && portfolioChart.options.rootId &&
              portfolioChart.options.rootId.split('___')
            if(rootId){
              Session.set('currentGraphBreadcrumbs', {key: rootId[0], version: rootId[1]})
            }
            if (firstPoint !== undefined) {
              let currentId = firstPoint._model.id && firstPoint._model.id.split('___')
              Session.set('currentComponent', currentId[0])
            }
          };
        }
      }
      Session.set('graphLoading',false);
    });
  }
}

Template.moduleSunburst.helpers({
  toManyItemsHint: function () {
    return Session.get('toManyItemsHint');
  }
});
