import {Template} from 'meteor/templating';
import jsVectorMap from 'jsvectormap'
import 'jsvectormap/dist/maps/world.js'
import 'jsvectormap/dist/jsvectormap.css';

Template.mapHighlighter.onRendered(function() {
  this.autorun(function () {
    const selected = Template.currentData().selected
    const values = {}
    const scales = ['exportIrrelevant', 'exportStrict', 'exportWeak', 'importIrrelevant', 'importStrict', 'importWeak']
    scales.forEach((scale) => {
      selected[scale].forEach((country) => {
        if(scale === 'exportStrict' || scale === 'importStrict'){
          values[country] = 'Strict'
        }else if((scale === 'exportWeak' || scale === 'importWeak')){
          if((values[country] && values[country] !== 'Strict') || !values[country]){
            values[country] = 'Weak'
          }
           
        }else if(scale === 'exportIrrelevant' || scale === 'importIrrelevant'){
          if((values[country] && (values[country] !== 'Strict' || values[country] !== 'Weak')) || !values[country]){
            values[country] = 'Irrelevant'
          }
        }
      })
    })
    new jsVectorMap({
      selector: '.map-highlighter',
      map: 'world',
      series: {
        regions: [
          {
            attribute: 'fill',
            legend: {
              title: selected.key + (selected.strength ? `[${selected.strength}]` : ''),
              vertical: true
            },
            scale: {
              'Strict': '#D55E00',
              'Weak': '#E69F00',
              'Irrelevant': '#009E73'
            },
            values
          }
        ]
      }
    })
  })
});
