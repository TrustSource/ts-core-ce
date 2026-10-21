// Ensure window.jQuery is set so that select2.full.js (loaded as bare)
// picks up Meteor's jQuery via the UMD browser path.
import { $ } from 'meteor/jquery';
if (typeof window !== 'undefined' && !window.jQuery) {
  window.jQuery = $;
}
