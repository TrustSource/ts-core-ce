Package.describe({
  name: 'fourq:typeahead',
  summary: 'Typeahead wrapper (local fork for Meteor 3)',
  version: '1.0.1',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use('ecmascript', 'client');
  api.use('jquery', 'client');
  // First: ensure window.jQuery is set (module-scoped, runs before bare files)
  api.addFiles('typeahead-loader.js', 'client');
  // Then: load typeahead.js bundle as bare script so its UMD uses the
  // browser/global path (window.jQuery) instead of require('jquery')
  api.addFiles('typeahead.bundle.js', 'client', { bare: true });
});
