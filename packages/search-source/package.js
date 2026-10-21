Package.describe({
  "summary": "Reactive Data Source for Search (local fork for Meteor 3)",
  "version": "1.5.0",
  "git": "https://github.com/meteorhacks/search-source.git",
  "name": "meteorhacks:search-source"
});

Npm.depends({
  "body-parser": "1.20.2"
});

Package.onUse(function(api) {
  configurePackage(api);
  api.export(['SearchSource']);
});

function configurePackage(api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use([
    'tracker', 'underscore', 'mongo', 'reactive-var',
    'fetch', 'ejson', 'check', 'ddp'
  ], ['client']);

  api.use(['ejson', 'check', 'ddp', 'webapp'], ['server']);

  api.addFiles([
    'lib/server.js',
  ], ['server']);

  api.addFiles([
    'lib/client.js',
  ], ['client']);
}
