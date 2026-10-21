Package.describe({
  name: 'harrison:papa-parse',
  summary: 'PapaParse wrapper (local fork for Meteor 3)',
  version: '1.1.8',
});

Npm.depends({
  'papaparse': '5.4.1',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use('ecmascript', 'client');
  api.addFiles('papa-loader.js', 'client');
});
