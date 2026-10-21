Package.describe({
  name: 'hwillson:stub-collections',
  summary: 'Stub collections for testing (local fork for Meteor 3)',
  version: '1.1.0',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use(['ecmascript', 'mongo'], ['client', 'server']);
  api.addFiles('stub.js', ['client', 'server']);
});
