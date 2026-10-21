Package.describe({
  name: 'muqube:autoform-nouislider',
  summary: 'Autoform noUiSlider (local fork for Meteor 3)',
  version: '0.5.3',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use(['ecmascript', 'templating', 'blaze', 'reactive-var', 'aldeed:autoform'], 'client');
  api.addFiles(['nouislider.html', 'stub.js'], 'client');
});
