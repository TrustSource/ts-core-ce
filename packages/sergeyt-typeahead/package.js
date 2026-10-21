Package.describe({
  name: 'sergeyt:typeahead',
  summary: 'Typeahead wrapper (local fork for Meteor 3)',
  version: '1.2.1',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use('ecmascript', 'client');
  api.use('jquery', 'client');
  api.use('blaze@3.0.0', 'client');
  api.use('templating-runtime@2.0.0', 'client');
  api.addFiles('typeahead-loader.js', 'client');
});
