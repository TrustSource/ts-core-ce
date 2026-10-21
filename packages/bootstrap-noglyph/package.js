Package.describe({
  name: 'twbs:bootstrap-noglyph',
  summary: 'Bootstrap 3.4.1 without Glyphicon fonts and the carousel plugin (local fork for Meteor 3)',
  version: '3.4.1',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use('jquery', 'client');
  api.addFiles('upstream/dist/css/bootstrap.css', 'client');
  api.addFiles('upstream/dist/js/bootstrap.js', 'client');
});
