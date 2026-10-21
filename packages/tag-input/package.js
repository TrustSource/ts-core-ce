Package.describe({
  name: 'stricker:tag-input',
  summary: 'Tag input (local fork for Meteor 3)',
  version: '1.0.2',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.16', '3.0']);
  api.use(['ecmascript', 'templating@1.4.4', 'reactive-var', 'jquery'], 'client');
  api.addFiles(['tag-input.html', 'tag-input-loader.js'], 'client');
});
