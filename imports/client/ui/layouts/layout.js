/* global window:false, document:false, setTimeout:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

Template.layout.onRendered(function () {

  const body = $('body');

  $(window).bind('resize click', function () {

    // Add special class to minimalize page elements when screen is less than 768px
    setBodySmall();

    // Wait until the sidebar collapse effect finishes and set wrapper height
    setTimeout(function () {
      fixWrapperHeight();
    }, 200);
  });

  // FIXED SIDEBAR
  body.addClass('fixed-sidebar');

  // FIXED NAVBAR
  body.addClass('fixed-navbar');

  // FIXED FOOTER
  // $('body').addClass('fixed-footer');

  // FIXED SMALL HEADER
  // $('body').addClass('fixed-compact-header');

  // hide left navigation
  // $('body').removeClass('show-sidebar');
  // $('body').addClass('hide-sidebar');

  // hide popovers if click outside occurs
  // TODO: see if pullrequest https://github.com/twbs/bootstrap/pull/17702 is part of bootstrap
  // manually applied the patch to the local meteor package.
  body.on('click', function (e) {
    $('[data-toggle="popover"]').each(function () {
      // the 'is' for buttons that trigger popups
      // the 'has' for icons within a button that triggers a popup
      if (!$(this).is(e.target) && $(this).has(e.target).length === 0 && $('.popover').has(e.target).length === 0) {
        $(this).popover('hide');
      }
    });
  });

  this.autorun(function () {
    let user = Meteor.user();
    if(user && user.profile && user.profile.theme){
      const body = $('body');
      body.removeClass('theme-dark theme-light');
      body.addClass('theme-'+user.profile.theme);
    }
    $(document).ready(function() {
      Meteor.setTimeout(fixWrapperHeight,1)
    });
  });

});

function fixWrapperHeight() {

  // Get and set current height
  const headerH = 62;
  const navigationH = $('#navigation').height();
  const contentH = $('.content').height();

  // Set new height when content height is less then navigation
  if (contentH < navigationH) {
     
    $('#wrapper').css('min-height', navigationH + 'px');
  }

  // Set new height when content height is less then navigation and navigation is less then window
  if (contentH < navigationH && navigationH < $(window).height()) {
     
    $('#wrapper').css('min-height', $(window).height() - headerH + 'px');
  }

  // Set new height when content is higher then navigation but less then window
  if (contentH > navigationH && contentH < $(window).height()) {
     
    $('#wrapper').css('min-height', $(window).height() - headerH + 'px');
  }
}

function setBodySmall() {
  if ($(window).width() < 769) {
    $('body').addClass('page-small');
  } else {
    $('body').removeClass('page-small');
    $('body').removeClass('show-sidebar');
  }
}
