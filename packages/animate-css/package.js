Package.describe({
  name: 'natestrauser:animate-css',
  summary: 'Animate.css (local fork for Meteor 3)',
  version: '3.5.2',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.addFiles('animate-loader.js', 'client');
});
