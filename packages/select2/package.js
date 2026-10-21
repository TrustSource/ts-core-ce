Package.describe({
  name: 'natestrauser:select2',
  summary: 'Select2 wrapper (local fork for Meteor 3)',
  version: '4.0.4',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use('ecmascript', 'client');
  api.use('jquery', 'client');
  // Loader sets window.jQuery so the UMD picks up Meteor's jQuery
  api.addFiles('select2-loader.js', 'client');
  // select2 JS loaded as bare so UMD takes browser path (window.jQuery)
  api.addFiles('select2.full.js', 'client', {bare: true});
  // CSS
  api.addFiles('select2.css', 'client');
});
