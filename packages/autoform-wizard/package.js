Package.describe({
  name: 'forwarder:autoform-wizard',
  summary: 'Autoform Wizard (local fork for Meteor 3)',
  version: '0.9.2',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use(['ecmascript', 'templating@1.4.4', 'blaze@3.0.0', 'reactive-var', 'aldeed:autoform@8.0.0'], 'client');
  api.addFiles(['wizard.html', 'stub.js'], 'client');
});
