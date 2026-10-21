Package.describe({
  name: 'kevohagan:sweetalert',
  summary: 'SweetAlert wrapper (local fork for Meteor 3)',
  version: '1.0.1',
});

Npm.depends({
  'sweetalert': '1.1.3',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use('ecmascript', 'client');
  api.addFiles('sweetalert.css', 'client');
  api.addFiles('sweetalert-loader.js', 'client');
});
