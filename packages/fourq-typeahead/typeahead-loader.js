// Ensure Meteor's jQuery is on window before typeahead.bundle.js loads (bare)
import { $ } from 'meteor/jquery';
window.jQuery = window.jQuery || $;
window.$ = window.$ || $;
