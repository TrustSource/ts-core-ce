Package.describe({
  name: 'aldeed:simple-schema',
  summary: 'SimpleSchema for Meteor 3 (local fork with named export)',
  version: '2.0.0',
});

Npm.depends({
  'clone': '2.1.2',
  'message-box': '0.2.7',
  'mongo-object': '3.0.1',
  'lodash.template': '4.5.0',
  'lodash.templatesettings': '4.2.0',
  'lodash._reinterpolate': '3.0.0',
});

Package.onUse(function (api) {
  api.versionsFrom(['3.0']);
  api.use('ecmascript');
  api.mainModule('main.js');
});
