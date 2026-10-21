Package.describe({
  name: 'aldeed:autoform-select2',
  summary: 'Autoform Select2 (local fork for Meteor 3)',
  version: '2.0.4',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use(['ecmascript', 'templating@1.4.4', 'blaze@3.0.0', 'aldeed:autoform@8.0.0'], 'client');
  api.addFiles(['select2.html', 'stub.js'], 'client');
});
