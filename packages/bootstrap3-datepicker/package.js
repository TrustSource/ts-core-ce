Package.describe({
  name: 'rajit:bootstrap3-datepicker',
  summary: 'Bootstrap 3 Datepicker (local fork for Meteor 3)',
  version: '1.7.2',
});

Npm.depends({
  'bootstrap-datepicker': '1.10.0',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use('ecmascript', 'client');
  api.use('jquery', 'client');
  api.addFiles('datepicker-loader.js', 'client');
});
