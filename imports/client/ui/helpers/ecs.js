import {Template} from 'meteor/templating';
import {Spacebars} from 'meteor/spacebars';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';

Template.registerHelper('ecsText', function (state) {
  switch (state) {
  case 'ok' :
    return 'OK';
  case 'warnings' :
    return 'Warnings';
  case 'violations' :
    return 'Violations';
  default :
    return 'unknown';
  }
});

Template.registerHelper('ecsLabel', function (state, label, cssClass) {
  let clazz;
  if (state instanceof Spacebars.kw) {
    label = state.hash.label;
    state = state.hash.state;
  }
  if (label instanceof Spacebars.kw) {
    label = label.hash.label;
  }
  switch (state) {
  case 'ok' :
    label = label || 'OK';
    clazz = 'ok';
    break;
  case 'warnings' :
    label = label || 'Warnings';
    clazz = 'warnings';
    break;
  case 'violations' :
    label = label || 'Violations';
    clazz = 'violations';
    break;
  case 'disabled' :
    label = label || 'Disabled';
    clazz = 'disabled';
    break;
  default :
    label = label || 'unknown';
    clazz = 'violations';
    break;
  }
  return `<span class='label  ecs-label ${clazz} ${escapeHtml(cssClass)}'>${escapeHtml(label)}</span>`;
});

Template.registerHelper('cvssLabel', function (title, label, score) {
  return `<span class='label cvss-label ${escapeHtml(label)}' title="${escapeHtml(title)}">Vulnerability ${escapeHtml(score)}</span>`;
});

Template.registerHelper('cvssLabelCompact', function (title, label, score) {
  return `<span class='label cvss-label cvss-label-compact inline-block ${escapeHtml(label)}' title="${escapeHtml(title)}">${escapeHtml(score)}</span>`;
});
