Package.describe({
  name: 'olexandrbig:bootstrap-treeview',
  version: '0.0.2',
  summary: 'Wrapper around bootstrap-treeview NPM package of https://github.com/jonmiles/bootstrap-treeview',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom(['2.16', '3.0']);
  api.addFiles('bootstrap-treeview.js');
  api.addFiles([
    'bootstrap-treeview.min.css',
    'bootstrap-treeview.min.js'
  ], 'client');
});

Package.onTest(function(api) {
  //api.use('tinytest');
  //api.use('kaso:bootstrap-treeview');
  //api.addFiles('bootstrap-treeview-tests.js');
});

// dist files bundled directly — no Npm.depends needed
