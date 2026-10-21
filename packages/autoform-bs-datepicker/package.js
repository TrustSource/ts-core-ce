Package.describe({
  name: 'aldeed:autoform-bs-datepicker',
  summary: 'Autoform Bootstrap Datepicker (local fork for Meteor 3)',
  version: '1.2.1',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use(['ecmascript', 'templating', 'blaze', 'underscore', 'aldeed:autoform'], 'client');
  api.addFiles('stub.js', 'client');
});
