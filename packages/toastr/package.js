Package.describe({
  name: 'chrismbeckett:toastr',
  summary: 'Toastr notifications (local fork for Meteor 3)',
  version: '2.1.3',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use('jquery', 'client');
  api.addFiles('toastr-loader.js', 'client');
});
