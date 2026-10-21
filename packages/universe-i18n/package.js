Package.describe({
  name: 'universe:i18n',
  version: '3.0.1',
  summary:
    'Lightweight i18n, YAML & JSON translation files (local fork: WHATWG URL instead of url.parse for Node 24)',
  documentation: null,
});

const npmDependencies = {
  'js-yaml': '4.1.0',
  'strip-json-comments': '3.1.1',
};

Npm.depends(npmDependencies);
Package.registerBuildPlugin({
  name: 'universe:i18n',
  use: ['caching-compiler@2.0.0', 'tracker', 'typescript'],
  sources: [
    'source/common.ts',
    'source/compiler.ts',
    'source/utils.ts',
    'source/code-generators.ts',
  ],
  npmDependencies,
});

Package.onUse(function (api) {
  api.versionsFrom(['3.0']);
  api.use([
    'check',
    'ddp',
    'fetch',
    'isobuild:compiler-plugin@1.0.0',
    'promise',
    'tracker',
    'typescript',
    'webapp',
    'zodern:types@1.0.13',
  ]);

  api.mainModule('source/client.ts', 'client');
  api.mainModule('source/server.ts', 'server');
  api.export(['i18n', '_i18n']);
});
