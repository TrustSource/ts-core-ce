Package.describe({
  name: 'aldeed:collection2',
  summary: 'Automatic validation of Mongo insert/update (local fork for Meteor 3 eager loading)',
  version: '4.1.5',
});

Package.onUse(function (api) {
  api.versionsFrom(['3.0']);
  api.use([
    'ecmascript',
    'mongo',
    'minimongo',
    'ejson',
    'raix:eventemitter@1.0.0 || 2.0.0',
    'aldeed:simple-schema@2.0.0',
  ]);
  api.use('insecure', { weak: true });
  api.use('zodern:types@1.0.13', { weak: true });
  api.imply('mongo');

  api.addFiles('collection2.js');
  api.addFiles('lib.js');
  api.addFiles('main.js');

  api.export('Collection2');
});
