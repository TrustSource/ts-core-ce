Package.describe({
  summary: "A reactive table designed for Meteor (local fork for Meteor 3)",
  version: "0.8.46",
  name: "aslagle:reactive-table",
  git: "https://github.com/aslagle/reactive-table.git"
});

Package.onUse(function (api) {
    api.versionsFrom(['2.16', '3.0']);
    api.use('templating', 'client');
    api.use('jquery', 'client');
    api.use('underscore', ['server', 'client']);
    api.use('tracker', 'client');
    api.use('reactive-var', 'client');
    api.use("anti:i18n@0.4.3", 'client', {weak: true});
    api.use("mongo", ["server", "client"]);
    api.use("check", "server");

    api.use("fortawesome:fontawesome@4.2.0", 'client', {weak: true});

    api.addFiles('lib/reactive_table.html', 'client');
    api.addFiles('lib/filter.html', 'client');
    api.addFiles('lib/reactive_table_i18n.js', 'client');
    api.addFiles('lib/reactive_table.js', 'client');
    api.addFiles('lib/reactive_table.css', 'client');
    api.addFiles('lib/sort.js', 'client');
    api.addFiles('lib/filter.js', ['client', 'server']);
    api.addFiles('lib/server.js', 'server');

    api.export("ReactiveTable", ["client", "server"]);
});
