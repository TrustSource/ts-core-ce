import {Template} from 'meteor/templating';
import searchRegExp from '/imports/lib/searchRegExp'
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';

Template.highlight.helpers({
  highlight: function () {
    // Rendered via {{{highlight}}} (raw). Escape the text first so a malicious
    // value (e.g. a component name) can't inject markup; the regex then wraps
    // the already-escaped match in the highlight tag (only 'bold'/default are
    // used as the replacement; both are developer-controlled).
    const text = escapeHtml(this.text);
    if (!this.query) {
      return text;
    }
    const regex = searchRegExp(this.query || '');
    const replace = this.component === 'bold' ? '<b>$&</b>' : '<span style="background: yellow;">$&</span>';
    return text.replace(regex, replace);
  }
});
