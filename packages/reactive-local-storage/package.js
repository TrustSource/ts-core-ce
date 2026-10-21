Package.describe({
  name: 'simply:reactive-local-storage',
  summary: 'Reactive localStorage (local fork for Meteor 3)',
  version: '2.1.1',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use(['tracker', 'ejson', 'ecmascript', 'modules'], 'client');
  api.mainModule('reactive-local-storage.js', 'client');
});
