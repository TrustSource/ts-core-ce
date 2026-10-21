import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Chart from 'chart.js';
import 'chartjs-chart-graph';  
import datalabels from 'chartjs-plugin-datalabels';

Template.dendrogramChart.onRendered(function () {
  Meteor.setTimeout(() => {
    renderChart(this.data && this.data.nodes);
  }, 1);
});

function renderChart(nodes) {
  let chart = $('.dendrogram-chart');
  if(chart){
    chart.empty();
    if(nodes && nodes.length){
      chart.append('<canvas id="dendrogram-chart" height="'+nodes.length*12+'" style="min-height: 400px"></canvas>');
      let canvas = $('#dendrogram-chart').get(0);
      const ctx = canvas.getContext('2d');
      Chart.plugins.register(datalabels)
      new Chart(ctx, {
        type: 'dendogram',
        data: {
          labels: nodes.map((d) => d.name),
          datasets: [{
            data: nodes.map((d) => Object.assign(Object.create(null), d)),
            pointBackgroundColor: '#040f18',
            pointRadius: 7
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              left: 20,
              top: 20,
              bottom: 20,
              right: 20
            }
          },
          legend: {
            display: false
          },
          tree: {
            mode: 'tree', //'dendogram' | 'tree'
            orientation: 'horizontal', // 'horizontal' | 'vertical' | 'radial',
            lineTension: 0.4
          },
          plugins: {
            datalabels: {
              align: 'left',
              offset: 6,
              'font.size': 6,
              padding: 2,
              borderRadius: 10,
              backgroundColor: 'rgba(214,214,213,0.5)',
              formatter: (v) => {
                return v.name;
              }
            }
          }
        }
      });
    }else{
      chart.empty();
      chart.append('<h4 style="height:213px; line-height:213px; display:block; text-align: center">' +
        'No data found for this chart</h4>');
    }
  }
}
