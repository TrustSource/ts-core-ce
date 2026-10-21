import {Router} from 'meteor/vlasky:galvanized-iron-router';

Router.route('pageNotFound', {
  path: '/api/(.*)',
  where: 'server',
  action: function () {
    this.response.writeHead(404);
    this.response.end('Page not found');
  }
});

Router.route('pageNotFoundV2', {
  path: '/v2/(.*)',
  where: 'server',
  action: function () {
    this.response.writeHead(404);
    this.response.end('Page not found');
  }
});
