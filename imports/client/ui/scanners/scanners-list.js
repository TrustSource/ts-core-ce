import {Template} from 'meteor/templating';
import _ from 'underscore';

const NODE_CLIENT_URL = 'https://github.com/TrustSource/ts-node-client'

Template.scannersList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.scannersList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.scannersList.helpers({
  scannerItems: function () {
    const items = [
      {
        type: 'pkg',
        name: 'Bower',
        image: 'bower.png',
        links: [
          {
            link: NODE_CLIENT_URL,
            type: 'Github'
          }
        ]
      },
      {
        type: 'pkg',
        name: 'Composer',
        image: 'composer.png',
        links: [
          {
            link: 'https://github.com/eacg-gmbh/ecs-composer',
            type: 'Github'
          }
        ]
      },
      {
        type: 'pipe',
        name: '.Net foundation',
        image: 'dotnetfoundation.png',
        links: [
          {
            link: 'https://github.com/eacg-gmbh/ts-dotnet',
            type: 'Github'
          }
        ]
      },
      {
        type: 'pkg',
        name: 'Gradle',
        image: 'gradle.png',
        links: [
          {
            link: 'https://github.com/TrustSource/ts-gradle-plugin',
            type: 'Github'
          }
        ]
      },
      {
        type: 'pkg',
        name: 'Grunt',
        image: 'grunt.png',
        links: [
          {
            link: 'https://github.com/eacg-gmbh/ecs-grunt-plugin',
            type: 'Github'
          }
        ]
      },
      {
        type: 'pkg',
        name: 'Gulp',
        image: 'gulp.png',
        links: []
      },
      {
        type: 'lang',
        name: 'Java',
        image: 'java.png',
        links: [
          {
            link: 'https://github.com/TrustSource/ts-java-client',
            type: 'Github'
          }
        ]
      },
      {
        type: 'lang',
        name: 'JavaScript',
        image: 'JavaScript.png',
        links: [
          {
            link: NODE_CLIENT_URL,
            type: 'Github'
          }
        ]
      },
      {
        type: 'pipe',
        name: 'Jenkins',
        image: 'jenkins.png',
        links: [
          {
            link: 'https://github.com/eacg-gmbh/ts-jenkins',
            type: 'Github'
          }
        ]
      },
      {
        type: 'pkg',
        name: 'Maven',
        image: 'maven.png',
        links: [
          {
            link: 'https://github.com/TrustSource/ts-mvn-plugin',
            type: 'Github'
          }
        ]
      },
      {
        type: 'lang',
        name: 'NodeJS',
        image: 'node.png',
        links: [
          {
            link: NODE_CLIENT_URL,
            type: 'Github'
          }
        ]
      },
      {
        type: 'pkg',
        name: 'npm',
        image: 'npm.png',
        links: [
          {
            link: NODE_CLIENT_URL,
            type: 'Github'
          }
        ]
      },
      {
        type: 'lang',
        name: 'C/C++',
        image: 'cpp.png',
        links: [
          {
            link: 'https://github.com/TrustSource/ts-ds-cmake',
            type: 'Github'
          }
        ]
      },
      {
        type: 'lang',
        name: 'PHP',
        image: 'php.png',
        links: [
          {
            link: 'https://github.com/eacg-gmbh/ecs-composer',
            type: 'Github'
          }
        ]
      },
      {
        type: 'lang',
        name: 'Python',
        image: 'python.png',
        links: [
          {
            link: 'https://github.com/TrustSource/ts-python-client',
            type: 'Github'
          }
        ]
      },
      {
        type: 'lang',
        name: 'Ruby',
        image: 'ruby.png',
        links: [
          {
            link: 'https://github.com/eacg-gmbh/ecs-bundler',
            type: 'Github'
          }
        ]
      },
      {
        type: 'pipe',
        name: 'TFS',
        image: 'tfs-2015-2013-2012.png',
        links: []
      },
      {
        type: 'plugin',
        name: 'VisualStudio',
        image: 'VisualStudio.png',
        links: [
          {
            link: 'https://marketplace.visualstudio.com/items?itemName=TrustSource.vsp4dotnetcore',
            type: 'Plugin'
          }
        ]
      },
      {
        type: 'pkg',
        name: 'Yarn',
        image: 'yarn.png',
        links: [
          {
            link: 'https://yarn.pm/ts-node-client',
            type: 'yarn.pm'
          },
          {
            link: NODE_CLIENT_URL,
            type: 'Github'
          }
        ]
      },
      {
        type: 'containers',
        name: 'Docker scanner',
        image: 'docker.png',
        links: [
          {
            link: 'https://github.com/TrustSource/ts-docker',
            type: 'Github'
          }
        ]
      }
    ]
    return _.groupBy(items,'type')
  }
});
