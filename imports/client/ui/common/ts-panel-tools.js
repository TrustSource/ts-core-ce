/* global setTimeout:false */

import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

Template.panelTools.events({

  'click .ts-panel-toggle': function (event) {
    event.preventDefault();
    const panelEl = $(event.target).closest('div.ts-panel');
    const icon = $(event.target).closest('i');
    const body = panelEl.find('div.panel-body');
    const footer = panelEl.find('div.panel-footer');
    body.slideToggle(300);
    footer.slideToggle(200);

    // Toggle icon from up to down
    icon.toggleClass('fa-chevron-up').toggleClass('fa-chevron-down');
    panelEl.toggleClass('').toggleClass('panel-collapse');
    setTimeout(function () {
      panelEl.resize();
      panelEl.find('[id^=map-]').resize();
    }, 50);
  },

  'click .ts-panel-close': function (event) {
    event.preventDefault();
    const panelEl = $(event.target).closest('div.ts-panel');
    panelEl.remove();
  }

});
