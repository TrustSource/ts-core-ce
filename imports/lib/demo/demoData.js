 
const DemoData = {
  getDemoScan: function (scanId, moduleId, user) {
    return {
      '_id': scanId,
      'project': 'Demo project',
      'module': 'Demo module',
      'moduleId': moduleId,
      'dependencies': [
        {
          'name': 'ecs-demo4angular',
          'key': 'npm:ecs-demo4angular',
          'description': 'TrustSource demo for Angular 4 with @angular/cli',
          'private': false,
          'licenses': [
            {
              'name': 'MIT'
            }
          ],
          'repoUrl': null,
          'dependencies': [
            {
              'name': '@angular/animations',
              'key': 'npm:@angular/animations',
              'description': 'Angular - animations integration with web-animationss',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/common',
              'key': 'npm:@angular/common',
              'description': 'Angular - commonly needed directives and services',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/compiler',
              'key': 'npm:@angular/compiler',
              'description': 'Angular - the compiler library',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/core',
              'key': 'npm:@angular/core',
              'description': 'Angular - the core framework',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/forms',
              'key': 'npm:@angular/forms',
              'description': 'Angular - directives and services for creating forms',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/http',
              'key': 'npm:@angular/http',
              'description': 'Angular - the http service',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/platform-browser',
              'key': 'npm:@angular/platform-browser',
              'description': 'Angular - library for using Angular in a web browser',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/platform-browser-dynamic',
              'key': 'npm:@angular/platform-browser-dynamic',
              'description': 'Angular - library for using Angular in a web browser with JIT compilation',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/router',
              'key': 'npm:@angular/router',
              'description': 'Angular - the routing library',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular/blob/master/modules/%40angular/router/README.md',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': '@angular/upgrade',
              'key': 'npm:@angular/upgrade',
              'description': 'Angular - the library for easing update from v1 to v2',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/angular#readme',
              'repoUrl': 'https://github.com/angular/angular.git',
              'dependencies': [],
              'versions': [
                '4.0.1'
              ]
            },
            {
              'name': 'angular-calendar',
              'key': 'npm:angular-calendar',
              'description': 'A calendar component for angular 4.0+ that can display events on a month, week or day view',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/mattlewis92/angular-calendar#readme',
              'repoUrl': 'https://github.com/mattlewis92/angular-calendar.git',
              'dependencies': [
                {
                  'name': 'angular-draggable-droppable',
                  'key': 'npm:angular-draggable-droppable',
                  'description': 'Drag and drop for angular 4.0+',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/mattlewis92/angular-draggable-droppable#readme',
                  'repoUrl': 'https://github.com/mattlewis92/angular-draggable-droppable.git',
                  'dependencies': [],
                  'versions': [
                    '1.0.1'
                  ]
                },
                {
                  'name': 'angular-resizable-element',
                  'key': 'npm:angular-resizable-element',
                  'description': 'An angular 4.0+ directive that allows an element to be dragged and resized',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/mattlewis92/angular-resizable-element#readme',
                  'repoUrl': 'https://github.com/mattlewis92/angular-resizable-element.git',
                  'dependencies': [],
                  'versions': [
                    '1.1.0'
                  ]
                },
                {
                  'name': 'calendar-utils',
                  'key': 'npm:calendar-utils',
                  'description': 'Utility functions to generate views for calendars',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/mattlewis92/calendar-utils#readme',
                  'repoUrl': 'https://github.com/mattlewis92/calendar-utils.git',
                  'dependencies': [],
                  'versions': [
                    '0.0.43'
                  ]
                },
                {
                  'name': 'date-fns',
                  'key': 'npm:date-fns',
                  'description': 'Modern JavaScript date utility library',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/date-fns/date-fns#readme',
                  'repoUrl': 'https://github.com/date-fns/date-fns.git',
                  'dependencies': [],
                  'versions': [
                    '1.28.4'
                  ]
                },
                {
                  'name': 'positioning',
                  'key': 'npm:positioning',
                  'description': 'The ng-bootstrap Positioning class as a standalone module',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/mattlewis92/positioning#readme',
                  'repoUrl': 'https://github.com/mattlewis92/positioning.git',
                  'dependencies': [],
                  'versions': [
                    '1.1.0'
                  ]
                }
              ],
              'versions': [
                '0.11.0'
              ]
            },
            {
              'name': 'angular-chart.js',
              'key': 'npm:angular-chart.js',
              'description': 'An angular.js wrapper for Chart.js',
              'private': false,
              'licenses': [
                {
                  'name': 'BSD-2-Clause'
                }
              ],
              'homepageUrl': 'http://jtblin.github.io/angular-chart.js/',
              'repoUrl': 'git://github.com/jtblin/angular-chart.js.git',
              'dependencies': [
                {
                  'name': 'angular',
                  'key': 'npm:angular',
                  'description': 'HTML enhanced for web apps',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'http://angularjs.org',
                  'repoUrl': 'https://github.com/angular/angular.js.git',
                  'dependencies': [],
                  'versions': [
                    '1.6.4'
                  ]
                },
                {
                  'name': 'chart.js',
                  'key': 'npm:chart.js',
                  'description': 'Simple HTML5 charts using the canvas element.',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'http://www.chartjs.org',
                  'repoUrl': 'https://github.com/chartjs/Chart.js.git',
                  'dependencies': [
                    {
                      'name': 'chartjs-color',
                      'key': 'npm:chartjs-color',
                      'description': 'Color conversion and manipulation with CSS string support',
                      'private': false,
                      'licenses': [
                        {
                          'name': 'MIT'
                        }
                      ],
                      'homepageUrl': 'https://github.com/chartjs/chartjs-color#readme',
                      'repoUrl': 'https://github.com/chartjs/chartjs-color.git',
                      'dependencies': [],
                      'versions': [
                        '2.1.0'
                      ]
                    },
                    {
                      'name': 'moment',
                      'key': 'npm:moment',
                      'description': 'Parse, validate, manipulate, and display dates',
                      'private': false,
                      'licenses': [
                        {
                          'name': 'MIT'
                        }
                      ],
                      'homepageUrl': 'http://momentjs.com',
                      'repoUrl': 'https://github.com/moment/moment.git',
                      'dependencies': [],
                      'versions': [
                        '2.18.1'
                      ]
                    }
                  ],
                  'versions': [
                    '2.3.0'
                  ]
                }
              ],
              'versions': [
                '1.1.1'
              ]
            },
            {
              'name': 'angular-intro.js',
              'key': 'npm:angular-intro.js',
              'description': 'Angular directive to wrap intro.js',
              'private': false,
              'licenses': [
                {
                  'name': 'AGPL-3.0'
                }
              ],
              'homepageUrl': 'https://github.com/mendhak/angular-intro.js',
              'repoUrl': 'git://github.com/mendhak/angular-intro.js.git',
              'dependencies': [],
              'versions': [
                '3.1.3'
              ]
            },
            {
              'name': 'angular2-datatable',
              'key': 'npm:angular2-datatable',
              'description': 'DataTable component for Angular2 framework',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/mariuszfoltak/angular2-datatable#readme',
              'repoUrl': 'https://github.com/mariuszfoltak/angular2-datatable.git',
              'dependencies': [
                {
                  'name': 'lodash',
                  'key': 'npm:lodash',
                  'description': 'Lodash modular utilities.',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://lodash.com/',
                  'repoUrl': 'https://github.com/lodash/lodash.git',
                  'dependencies': [],
                  'versions': [
                    '4.17.4'
                  ]
                }
              ],
              'versions': [
                '0.6.0'
              ]
            },
            {
              'name': 'angular2-ladda',
              'key': 'npm:angular2-ladda',
              'description': 'Angular Ladda module',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/moff/angular2-ladda#readme',
              'repoUrl': 'https://github.com/moff/angular2-ladda.git',
              'dependencies': [
                {
                  'name': 'ladda',
                  'key': 'npm:ladda',
                  'description': 'Buttons with built-in loading indicators',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT',
                      'url': 'https://github.com/hakimel/Ladda/blob/master/LICENSE'
                    }
                  ],
                  'homepageUrl': 'http://lab.hakim.se/ladda',
                  'repoUrl': 'git://github.com/hakimel/Ladda.git',
                  'dependencies': [
                    {
                      'name': 'spin.js',
                      'key': 'npm:spin.js',
                      'description': 'An animated CSS3 loading spinner with VML fallback for IE.',
                      'private': false,
                      'licenses': [
                        {
                          'name': 'MIT'
                        }
                      ],
                      'homepageUrl': 'https://github.com/fgnass/spin.js#readme',
                      'repoUrl': 'git://github.com/fgnass/spin.js.git',
                      'dependencies': [],
                      'versions': [
                        '2.3.2'
                      ]
                    }
                  ],
                  'versions': [
                    '1.0.0'
                  ]
                }
              ],
              'versions': [
                '1.2.0'
              ]
            },
            {
              'name': 'angular2-text-mask',
              'key': 'npm:angular2-text-mask',
              'description': 'Angular 2 directive for input text masking',
              'private': false,
              'licenses': [
                {
                  'name': 'Unlicense'
                }
              ],
              'homepageUrl': 'https://github.com/text-mask/text-mask/tree/master/angular2/#readme',
              'repoUrl': 'https://github.com/text-mask/text-mask.git',
              'dependencies': [
                {
                  'name': 'text-mask-core',
                  'key': 'npm:text-mask-core',
                  'description': 'Core of https://github.com/text-mask/text-mask',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'Unlicense'
                    }
                  ],
                  'homepageUrl': 'https://github.com/text-mask/text-mask/core/#readme',
                  'repoUrl': 'https://github.com/text-mask/text-mask.git',
                  'dependencies': [],
                  'versions': [
                    '5.0.1'
                  ]
                }
              ],
              'versions': [
                '8.0.0'
              ]
            },
            {
              'name': 'angular2-toaster',
              'key': 'npm:angular2-toaster',
              'description': 'An Angular 2 Toaster Notification library based on AngularJS-Toaster',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/stabzs/Angular2-Toaster#readme',
              'repoUrl': 'https://github.com/stabzs/Angular2-Toaster.git',
              'dependencies': [],
              'versions': [
                '3.0.1'
              ]
            },
            {
              'name': 'chart.js',
              'key': 'npm:chart.js',
              'description': 'Simple HTML5 charts using the canvas element.',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'http://www.chartjs.org',
              'repoUrl': 'https://github.com/chartjs/Chart.js.git',
              'dependencies': [
                {
                  'name': 'chartjs-color',
                  'key': 'npm:chartjs-color',
                  'description': 'Color conversion and manipulation with CSS string support',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/chartjs/chartjs-color#readme',
                  'repoUrl': 'https://github.com/chartjs/chartjs-color.git',
                  'dependencies': [
                    {
                      'name': 'chartjs-color-string',
                      'key': 'npm:chartjs-color-string',
                      'description': 'Parser and generator for CSS color strings',
                      'private': false,
                      'licenses': [
                        {
                          'name': 'MIT'
                        }
                      ],
                      'homepageUrl': 'https://github.com/harthur/color-string#readme',
                      'repoUrl': 'ssh://git@github.com/harthur/color-string.git',
                      'dependencies': [
                        {
                          'name': 'color-name',
                          'key': 'npm:color-name',
                          'description': 'A list of color names and its values',
                          'private': false,
                          'licenses': [
                            {
                              'name': 'MIT'
                            }
                          ],
                          'homepageUrl': 'https://github.com/dfcreative/color-name',
                          'repoUrl': 'ssh://git@github.com/dfcreative/color-name.git',
                          'dependencies': [],
                          'versions': [
                            '1.1.2'
                          ]
                        }
                      ],
                      'versions': [
                        '0.4.0'
                      ]
                    },
                    {
                      'name': 'color-convert',
                      'key': 'npm:color-convert',
                      'description': 'Plain color conversion functions',
                      'private': false,
                      'licenses': [],
                      'homepageUrl': 'https://github.com/harthur/color-convert#readme',
                      'repoUrl': 'ssh://git@github.com/harthur/color-convert.git',
                      'dependencies': [],
                      'versions': [
                        '0.5.3'
                      ]
                    }
                  ],
                  'versions': [
                    '2.1.0'
                  ]
                },
                {
                  'name': 'moment',
                  'key': 'npm:moment',
                  'description': 'Parse, validate, manipulate, and display dates',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'http://momentjs.com',
                  'repoUrl': 'https://github.com/moment/moment.git',
                  'dependencies': [],
                  'versions': [
                    '2.18.1'
                  ]
                }
              ],
              'versions': [
                '2.5.0'
              ]
            },
            {
              'name': 'core-js',
              'key': 'npm:core-js',
              'description': 'Standard library',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/zloirock/core-js#readme',
              'repoUrl': 'https://github.com/zloirock/core-js.git',
              'dependencies': [],
              'versions': [
                '2.4.1'
              ]
            },
            {
              'name': 'dragula',
              'key': 'npm:dragula',
              'description': 'Drag and drop so simple it hurts',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/bevacqua/dragula',
              'repoUrl': 'https://github.com/bevacqua/dragula.git',
              'dependencies': [
                {
                  'name': 'contra',
                  'key': 'npm:contra',
                  'description': 'Asynchronous flow control with a functional taste to it',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/bevacqua/contra',
                  'repoUrl': 'git://github.com/bevacqua/contra.git',
                  'dependencies': [
                    {
                      'name': 'atoa',
                      'key': 'npm:atoa',
                      'description': 'Creates a true array based on `arraylike`, starting at `startIndex`.',
                      'private': false,
                      'licenses': [
                        {
                          'name': 'MIT'
                        }
                      ],
                      'homepageUrl': 'https://github.com/bevacqua/atoa#readme',
                      'repoUrl': 'https://github.com/bevacqua/atoa.git',
                      'dependencies': [],
                      'versions': [
                        '1.0.0'
                      ]
                    },
                    {
                      'name': 'ticky',
                      'key': 'npm:ticky',
                      'description': 'Run a callback as soon as possible',
                      'private': false,
                      'licenses': [
                        {
                          'name': 'MIT'
                        }
                      ],
                      'homepageUrl': 'https://github.com/bevacqua/ticky#readme',
                      'repoUrl': 'https://github.com/bevacqua/ticky.git',
                      'dependencies': [],
                      'versions': [
                        '1.0.1'
                      ]
                    }
                  ],
                  'versions': [
                    '1.9.4'
                  ]
                },
                {
                  'name': 'crossvent',
                  'key': 'npm:crossvent',
                  'description': 'Cross-platform browser event handling',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/bevacqua/crossvent',
                  'repoUrl': 'git://github.com/bevacqua/crossvent.git',
                  'dependencies': [
                    {
                      'name': 'custom-event',
                      'key': 'npm:custom-event',
                      'description': 'Cross-browser `CustomEvent` constructor',
                      'private': false,
                      'licenses': [
                        {
                          'name': 'MIT'
                        }
                      ],
                      'homepageUrl': 'https://github.com/webmodules/custom-event',
                      'repoUrl': 'git://github.com/webmodules/custom-event.git',
                      'dependencies': [],
                      'versions': [
                        '1.0.0'
                      ]
                    }
                  ],
                  'versions': [
                    '1.5.4'
                  ]
                }
              ],
              'versions': [
                '3.7.2'
              ]
            },
            {
              'name': 'format-as-currency',
              'key': 'npm:format-as-currency',
              'description': 'Angular directive to format an input as a currency as the user types',
              'private': false,
              'licenses': [
                {
                  'name': 'CC-BY-4.0'
                }
              ],
              'homepageUrl': 'https://github.com/bcherny/format-as-currency',
              'repoUrl': 'https://github.com/bcherny/format-as-currency.git',
              'dependencies': [],
              'versions': [
                '3.1.3'
              ]
            },
            {
              'name': 'jslicense-wtfpl',
              'key': 'npm:jslicense-wtfpl',
              'description': 'the Do What the Fuck You Want To Public License in jslicense format',
              'private': false,
              'licenses': [
                {
                  'name': 'Apache-2.0'
                }
              ],
              'homepageUrl': 'https://jslicense.github.io',
              'repoUrl': 'https://github.com/jslicense/jslicense-wtfpl.git',
              'dependencies': [],
              'versions': [
                '0.1.1'
              ]
            },
            {
              'name': 'moment',
              'key': 'npm:moment',
              'description': 'Parse, validate, manipulate, and display dates',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'http://momentjs.com',
              'repoUrl': 'https://github.com/moment/moment.git',
              'dependencies': [],
              'versions': [
                '2.18.1'
              ]
            },
            {
              'name': 'ng2-bootstrap',
              'key': 'npm:ng2-bootstrap',
              'description': 'Native Angular Bootstrap Components',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/valor-software/ng2-bootstrap#readme',
              'repoUrl': 'ssh://git@github.com/valor-software/ng2-bootstrap.git',
              'dependencies': [
                {
                  'name': 'moment',
                  'key': 'npm:moment',
                  'description': 'Parse, validate, manipulate, and display dates',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'http://momentjs.com',
                  'repoUrl': 'https://github.com/moment/moment.git',
                  'dependencies': [],
                  'versions': [
                    '2.18.1'
                  ]
                }
              ],
              'versions': [
                '1.6.1'
              ]
            },
            {
              'name': 'ng2-charts',
              'key': 'npm:ng2-charts',
              'description': 'Reactive, responsive, beautiful charts for Angular2 based on Chart.js',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/valor-software/ng2-charts#readme',
              'repoUrl': 'ssh://git@github.com/valor-software/ng2-charts.git',
              'dependencies': [
                {
                  'name': 'chart.js',
                  'key': 'npm:chart.js',
                  'description': 'Simple HTML5 charts using the canvas element.',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'http://www.chartjs.org',
                  'repoUrl': 'https://github.com/chartjs/Chart.js.git',
                  'dependencies': [],
                  'versions': [
                    '2.5.0'
                  ]
                }
              ],
              'versions': [
                '1.5.0'
              ]
            },
            {
              'name': 'ng2-dragula',
              'key': 'npm:ng2-dragula',
              'description': 'Simple drag and drop with dragula',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/valor-software/ng2-dragula#readme',
              'repoUrl': 'https://github.com/valor-software/ng2-dragula.git',
              'dependencies': [
                {
                  'name': 'dragula',
                  'key': 'npm:dragula',
                  'description': 'Drag and drop so simple it hurts',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/bevacqua/dragula',
                  'repoUrl': 'https://github.com/bevacqua/dragula.git',
                  'dependencies': [],
                  'versions': [
                    '3.7.2'
                  ]
                }
              ],
              'versions': [
                '1.3.0'
              ]
            },
            {
              'name': 'ng2-select',
              'key': 'npm:ng2-select',
              'description': 'Angular2 based replacement for select boxes',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/valor-software/ng2-select#readme',
              'repoUrl': 'ssh://git@github.com/valor-software/ng2-select.git',
              'dependencies': [],
              'versions': [
                '1.2.0'
              ]
            },
            {
              'name': 'rxjs',
              'key': 'npm:rxjs',
              'description': 'Reactive Extensions for modern JavaScript',
              'private': false,
              'licenses': [
                {
                  'name': 'Apache-2.0'
                }
              ],
              'homepageUrl': 'https://github.com/ReactiveX/RxJS',
              'repoUrl': 'ssh://git@github.com/ReactiveX/RxJS.git',
              'dependencies': [
                {
                  'name': 'symbol-observable',
                  'key': 'npm:symbol-observable',
                  'description': 'Symbol.observable ponyfill',
                  'private': false,
                  'licenses': [
                    {
                      'name': 'MIT'
                    }
                  ],
                  'homepageUrl': 'https://github.com/blesh/symbol-observable#readme',
                  'repoUrl': 'https://github.com/blesh/symbol-observable.git',
                  'dependencies': [],
                  'versions': [
                    '1.0.4'
                  ]
                }
              ],
              'versions': [
                '5.2.0'
              ]
            },
            {
              'name': 'ts-helpers',
              'key': 'npm:ts-helpers',
              'description': 'Typescript helpers for compiling typescript while specifying ' +
              '`--noEmitHelpers` within your `tsconfig.json`. Cross platform ( Node/Browser/WebWorker )',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/ngParty/ts-helpers#readme',
              'repoUrl': 'https://github.com/ngParty/ts-helpers.git',
              'dependencies': [],
              'versions': [
                '1.1.2'
              ]
            },
            {
              'name': 'zone.js',
              'key': 'npm:zone.js',
              'description': 'Zones for JavaScript',
              'private': false,
              'licenses': [
                {
                  'name': 'MIT'
                }
              ],
              'homepageUrl': 'https://github.com/angular/zone.js#readme',
              'repoUrl': 'git://github.com/angular/zone.js.git',
              'dependencies': [],
              'versions': [
                '0.8.5'
              ]
            }
          ],
          'versions': [
            '1.8.1'
          ]
        }
      ],
      'user': user.profile.email,
      'companyId': user.profile.companyId,
      'submitted': new Date(),
      'moduleIdentifier': 'npm:demo module',
      'dependencyCount': 50,
      'demo': true
    }
  },
  getDemoModuleAnalysis: function (scanId, moduleId, companyId) {
    return {
      'date': new Date(),
      'demo': true,
      'companyId': companyId,
      'scanId': scanId,
      'moduleId': moduleId,
      'components': [
        {
          'key': 'npm:ecs-demo4angular',
          'versions': [
            {
              'version': '1.8.1',
              'paths': [
                {
                  'path': '/',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/animations',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/animations:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/common',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/common:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/compiler',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/compiler:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/core',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/core:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/forms',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/forms:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/http',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/http:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/platform-browser',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/platform-browser:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/platform-browser-dynamic',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/platform-browser-dynamic:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/router',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/router:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:@angular/upgrade',
          'versions': [
            {
              'version': '4.0.1',
              'paths': [
                {
                  'path': '/@angular/upgrade:4.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular-calendar',
          'versions': [
            {
              'version': '0.11.0',
              'paths': [
                {
                  'path': '/angular-calendar:0.11.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular-draggable-droppable',
          'versions': [
            {
              'version': '1.0.1',
              'paths': [
                {
                  'path': '/angular-calendar:0.11.0/angular-draggable-droppable:1.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular-resizable-element',
          'versions': [
            {
              'version': '1.1.0',
              'paths': [
                {
                  'path': '/angular-calendar:0.11.0/angular-resizable-element:1.1.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:calendar-utils',
          'versions': [
            {
              'version': '0.0.43',
              'paths': [
                {
                  'path': '/angular-calendar:0.11.0/calendar-utils:0.0.43',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:date-fns',
          'versions': [
            {
              'version': '1.28.4',
              'paths': [
                {
                  'path': '/angular-calendar:0.11.0/date-fns:1.28.4',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:positioning',
          'versions': [
            {
              'version': '1.1.0',
              'paths': [
                {
                  'path': '/angular-calendar:0.11.0/positioning:1.1.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular-chart.js',
          'versions': [
            {
              'version': '1.1.1',
              'paths': [
                {
                  'path': '/angular-chart.js:1.1.1',
                  'licenses': [
                    {
                      'key': 'BSD-2-Clause',
                      'status': {
                        'status': 'violations',
                        'violations': 'LS_1; CA_2',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular',
          'versions': [
            {
              'version': '1.6.4',
              'paths': [
                {
                  'path': '/angular-chart.js:1.1.1/angular:1.6.4',
                  'licenses': [
                    {
                      'key': 'npm:angular',
                      'status': {
                        'status': 'warnings',
                        'reason': 'Please contact support. Certain aspects of this license are currently under investigation'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:chart.js',
          'versions': [
            {
              'version': '2.3.0',
              'paths': [
                {
                  'path': '/angular-chart.js:1.1.1/chart.js:2.3.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            },
            {
              'version': '2.5.0',
              'paths': [
                {
                  'path': '/chart.js:2.5.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                },
                {
                  'path': '/ng2-charts:1.5.0/chart.js:2.5.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:chartjs-color',
          'versions': [
            {
              'version': '2.1.0',
              'paths': [
                {
                  'path': '/angular-chart.js:1.1.1/chart.js:2.3.0/chartjs-color:2.1.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                },
                {
                  'path': '/chart.js:2.5.0/chartjs-color:2.1.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:moment',
          'versions': [
            {
              'version': '2.18.1',
              'paths': [
                {
                  'path': '/angular-chart.js:1.1.1/chart.js:2.3.0/moment:2.18.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                },
                {
                  'path': '/chart.js:2.5.0/moment:2.18.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                },
                {
                  'path': '/moment:2.18.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                },
                {
                  'path': '/ng2-bootstrap:1.6.1/moment:2.18.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular-intro.js',
          'versions': [
            {
              'version': '3.1.3',
              'paths': [
                {
                  'path': '/angular-intro.js:3.1.3',
                  'licenses': [
                    {
                      'key': 'AGPL-3.0',
                      'status': {
                        'status': 'violations',
                        'violations': 'LS_1; TS_1; IP_3; TS_3; CA_2',
                        'obligations': 'O00; O01; O02; O40; O41; O42'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular2-datatable',
          'versions': [
            {
              'version': '0.6.0',
              'paths': [
                {
                  'path': '/angular2-datatable:0.6.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:lodash',
          'versions': [
            {
              'version': '4.17.4',
              'paths': [
                {
                  'path': '/angular2-datatable:0.6.0/lodash:4.17.4',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular2-ladda',
          'versions': [
            {
              'version': '1.2.0',
              'paths': [
                {
                  'path': '/angular2-ladda:1.2.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:ladda',
          'versions': [
            {
              'version': '1.0.0',
              'paths': [
                {
                  'path': '/angular2-ladda:1.2.0/ladda:1.0.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:spin.js',
          'versions': [
            {
              'version': '2.3.2',
              'paths': [
                {
                  'path': '/angular2-ladda:1.2.0/ladda:1.0.0/spin.js:2.3.2',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular2-text-mask',
          'versions': [
            {
              'version': '8.0.0',
              'paths': [
                {
                  'path': '/angular2-text-mask:8.0.0',
                  'licenses': [
                    {
                      'key': 'Unlicense',
                      'status': {
                        'status': 'ok',
                        'obligations': ''
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:text-mask-core',
          'versions': [
            {
              'version': '5.0.1',
              'paths': [
                {
                  'path': '/angular2-text-mask:8.0.0/text-mask-core:5.0.1',
                  'licenses': [
                    {
                      'key': 'Unlicense',
                      'status': {
                        'status': 'ok',
                        'obligations': ''
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:angular2-toaster',
          'versions': [
            {
              'version': '3.0.1',
              'paths': [
                {
                  'path': '/angular2-toaster:3.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:chartjs-color-string',
          'versions': [
            {
              'version': '0.4.0',
              'paths': [
                {
                  'path': '/chart.js:2.5.0/chartjs-color:2.1.0/chartjs-color-string:0.4.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:color-name',
          'versions': [
            {
              'version': '1.1.2',
              'paths': [
                {
                  'path': '/chart.js:2.5.0/chartjs-color:2.1.0/chartjs-color-string:0.4.0/color-name:1.1.2',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:color-convert',
          'versions': [
            {
              'version': '0.5.3',
              'paths': [
                {
                  'path': '/chart.js:2.5.0/chartjs-color:2.1.0/color-convert:0.5.3',
                  'licenses': [
                    {
                      'key': 'Unlicense',
                      'status': {
                        'status': 'ok',
                        'obligations': ''
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:core-js',
          'versions': [
            {
              'version': '2.4.1',
              'paths': [
                {
                  'path': '/core-js:2.4.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:dragula',
          'versions': [
            {
              'version': '3.7.2',
              'paths': [
                {
                  'path': '/dragula:3.7.2',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                },
                {
                  'path': '/ng2-dragula:1.3.0/dragula:3.7.2',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:contra',
          'versions': [
            {
              'version': '1.9.4',
              'paths': [
                {
                  'path': '/dragula:3.7.2/contra:1.9.4',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:atoa',
          'versions': [
            {
              'version': '1.0.0',
              'paths': [
                {
                  'path': '/dragula:3.7.2/contra:1.9.4/atoa:1.0.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:ticky',
          'versions': [
            {
              'version': '1.0.1',
              'paths': [
                {
                  'path': '/dragula:3.7.2/contra:1.9.4/ticky:1.0.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:crossvent',
          'versions': [
            {
              'version': '1.5.4',
              'paths': [
                {
                  'path': '/dragula:3.7.2/crossvent:1.5.4',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:custom-event',
          'versions': [
            {
              'version': '1.0.0',
              'paths': [
                {
                  'path': '/dragula:3.7.2/crossvent:1.5.4/custom-event:1.0.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:format-as-currency',
          'versions': [
            {
              'version': '3.1.3',
              'paths': [
                {
                  'path': '/format-as-currency:3.1.3',
                  'licenses': [
                    {
                      'key': 'CC-BY-4.0',
                      'status': {
                        'status': 'warnings',
                        'reason': 'License could not be matched correctly'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:jslicense-wtfpl',
          'versions': [
            {
              'version': '0.1.1',
              'paths': [
                {
                  'path': '/jslicense-wtfpl:0.1.1',
                  'licenses': [
                    {
                      'key': 'Apache-2.0',
                      'status': {
                        'status': 'violations',
                        'violations': 'CA_2',
                        'obligations': 'O00; O01; O42'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:ng2-bootstrap',
          'versions': [
            {
              'version': '1.6.1',
              'paths': [
                {
                  'path': '/ng2-bootstrap:1.6.1',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:ng2-charts',
          'versions': [
            {
              'version': '1.5.0',
              'paths': [
                {
                  'path': '/ng2-charts:1.5.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:ng2-dragula',
          'versions': [
            {
              'version': '1.3.0',
              'paths': [
                {
                  'path': '/ng2-dragula:1.3.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:ng2-select',
          'versions': [
            {
              'version': '1.2.0',
              'paths': [
                {
                  'path': '/ng2-select:1.2.0',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:rxjs',
          'versions': [
            {
              'version': '5.2.0',
              'paths': [
                {
                  'path': '/rxjs:5.2.0',
                  'licenses': [
                    {
                      'key': 'Apache-2.0',
                      'status': {
                        'status': 'violations',
                        'violations': 'CA_2',
                        'obligations': 'O00; O01; O42'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:symbol-observable',
          'versions': [
            {
              'version': '1.0.4',
              'paths': [
                {
                  'path': '/rxjs:5.2.0/symbol-observable:1.0.4',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:ts-helpers',
          'versions': [
            {
              'version': '1.1.2',
              'paths': [
                {
                  'path': '/ts-helpers:1.1.2',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'npm:zone.js',
          'versions': [
            {
              'version': '0.8.5',
              'paths': [
                {
                  'path': '/zone.js:0.8.5',
                  'licenses': [
                    {
                      'key': 'MIT',
                      'status': {
                        'status': 'ok',
                        'obligations': 'O00; O01'
                      }
                    }
                  ]
                }
              ]
            }
          ],
          'status': 'ok'
        }
      ],
      'licenses': [
        {
          'key': 'Apache-2.0',
          'name': 'Apache License 2.0',
          'components': [
            {
              'componentKey': 'npm:jslicense-wtfpl',
              'version': '0.1.1',
              'path': '/jslicense-wtfpl:0.1.1',
              'status': {
                'status': 'violations',
                'violations': 'CA_2',
                'obligations': 'O00; O01; O42'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:rxjs',
              'version': '5.2.0',
              'path': '/rxjs:5.2.0',
              'status': {
                'status': 'violations',
                'violations': 'CA_2',
                'obligations': 'O00; O01; O42'
              },
              'requireWhitelist': null,
              'privateLicense': false
            }
          ],
          'status': 'violations'
        },
        {
          'key': 'BSD-2-Clause',
          'name': 'BSD 2-clause \'Simplified\' License',
          'components': [
            {
              'componentKey': 'npm:angular-chart.js',
              'version': '1.1.1',
              'path': '/angular-chart.js:1.1.1',
              'status': {
                'status': 'violations',
                'violations': 'LS_1; CA_2',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            }
          ],
          'status': 'violations'
        },
        {
          'key': 'CC-BY-4.0',
          'name': 'Creative Commons Attribution 4.0',
          'components': [
            {
              'componentKey': 'npm:format-as-currency',
              'version': '3.1.3',
              'path': '/format-as-currency:3.1.3',
              'status': {
                'status': 'warnings',
                'reason': 'License could not be matched correctly'
              },
              'requireWhitelist': null,
              'privateLicense': false
            }
          ],
          'status': 'warnings'
        },
        {
          'key': 'AGPL-3.0',
          'name': 'GNU Affero General Public License v3.0',
          'components': [
            {
              'componentKey': 'npm:angular-intro.js',
              'version': '3.1.3',
              'path': '/angular-intro.js:3.1.3',
              'status': {
                'status': 'violations',
                'violations': 'LS_1; TS_1; IP_3; TS_3; CA_2',
                'obligations': 'O00; O01; O02; O40; O41; O42'
              },
              'requireWhitelist': null,
              'privateLicense': false
            }
          ],
          'status': 'violations'
        },
        {
          'key': 'MIT',
          'name': 'MIT License',
          'components': [
            {
              'componentKey': 'npm:ecs-demo4angular',
              'version': '1.8.1',
              'path': '/',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/animations',
              'version': '4.0.1',
              'path': '/@angular/animations:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/common',
              'version': '4.0.1',
              'path': '/@angular/common:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/compiler',
              'version': '4.0.1',
              'path': '/@angular/compiler:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/core',
              'version': '4.0.1',
              'path': '/@angular/core:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/forms',
              'version': '4.0.1',
              'path': '/@angular/forms:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/http',
              'version': '4.0.1',
              'path': '/@angular/http:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/platform-browser',
              'version': '4.0.1',
              'path': '/@angular/platform-browser:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/platform-browser-dynamic',
              'version': '4.0.1',
              'path': '/@angular/platform-browser-dynamic:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/router',
              'version': '4.0.1',
              'path': '/@angular/router:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:@angular/upgrade',
              'version': '4.0.1',
              'path': '/@angular/upgrade:4.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:angular-calendar',
              'version': '0.11.0',
              'path': '/angular-calendar:0.11.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:angular-draggable-droppable',
              'version': '1.0.1',
              'path': '/angular-calendar:0.11.0/angular-draggable-droppable:1.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:angular-resizable-element',
              'version': '1.1.0',
              'path': '/angular-calendar:0.11.0/angular-resizable-element:1.1.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:calendar-utils',
              'version': '0.0.43',
              'path': '/angular-calendar:0.11.0/calendar-utils:0.0.43',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:date-fns',
              'version': '1.28.4',
              'path': '/angular-calendar:0.11.0/date-fns:1.28.4',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:positioning',
              'version': '1.1.0',
              'path': '/angular-calendar:0.11.0/positioning:1.1.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chart.js',
              'version': '2.3.0',
              'path': '/angular-chart.js:1.1.1/chart.js:2.3.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chartjs-color',
              'version': '2.1.0',
              'path': '/angular-chart.js:1.1.1/chart.js:2.3.0/chartjs-color:2.1.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chartjs-color',
              'version': '2.1.0',
              'path': '/chart.js:2.5.0/chartjs-color:2.1.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/angular-chart.js:1.1.1/chart.js:2.3.0/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/chart.js:2.5.0/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/ng2-bootstrap:1.6.1/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:angular2-datatable',
              'version': '0.6.0',
              'path': '/angular2-datatable:0.6.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:lodash',
              'version': '4.17.4',
              'path': '/angular2-datatable:0.6.0/lodash:4.17.4',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:angular2-ladda',
              'version': '1.2.0',
              'path': '/angular2-ladda:1.2.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:ladda',
              'version': '1.0.0',
              'path': '/angular2-ladda:1.2.0/ladda:1.0.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:spin.js',
              'version': '2.3.2',
              'path': '/angular2-ladda:1.2.0/ladda:1.0.0/spin.js:2.3.2',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:angular2-toaster',
              'version': '3.0.1',
              'path': '/angular2-toaster:3.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chart.js',
              'version': '2.5.0',
              'path': '/chart.js:2.5.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chart.js',
              'version': '2.5.0',
              'path': '/ng2-charts:1.5.0/chart.js:2.5.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chartjs-color',
              'version': '2.1.0',
              'path': '/angular-chart.js:1.1.1/chart.js:2.3.0/chartjs-color:2.1.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chartjs-color',
              'version': '2.1.0',
              'path': '/chart.js:2.5.0/chartjs-color:2.1.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chartjs-color-string',
              'version': '0.4.0',
              'path': '/chart.js:2.5.0/chartjs-color:2.1.0/chartjs-color-string:0.4.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:color-name',
              'version': '1.1.2',
              'path': '/chart.js:2.5.0/chartjs-color:2.1.0/chartjs-color-string:0.4.0/color-name:1.1.2',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/angular-chart.js:1.1.1/chart.js:2.3.0/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/chart.js:2.5.0/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/ng2-bootstrap:1.6.1/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:core-js',
              'version': '2.4.1',
              'path': '/core-js:2.4.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:dragula',
              'version': '3.7.2',
              'path': '/dragula:3.7.2',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:dragula',
              'version': '3.7.2',
              'path': '/ng2-dragula:1.3.0/dragula:3.7.2',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:contra',
              'version': '1.9.4',
              'path': '/dragula:3.7.2/contra:1.9.4',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:atoa',
              'version': '1.0.0',
              'path': '/dragula:3.7.2/contra:1.9.4/atoa:1.0.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:ticky',
              'version': '1.0.1',
              'path': '/dragula:3.7.2/contra:1.9.4/ticky:1.0.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:crossvent',
              'version': '1.5.4',
              'path': '/dragula:3.7.2/crossvent:1.5.4',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:custom-event',
              'version': '1.0.0',
              'path': '/dragula:3.7.2/crossvent:1.5.4/custom-event:1.0.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/angular-chart.js:1.1.1/chart.js:2.3.0/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/chart.js:2.5.0/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/ng2-bootstrap:1.6.1/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:ng2-bootstrap',
              'version': '1.6.1',
              'path': '/ng2-bootstrap:1.6.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/angular-chart.js:1.1.1/chart.js:2.3.0/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/chart.js:2.5.0/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:moment',
              'version': '2.18.1',
              'path': '/ng2-bootstrap:1.6.1/moment:2.18.1',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:ng2-charts',
              'version': '1.5.0',
              'path': '/ng2-charts:1.5.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chart.js',
              'version': '2.5.0',
              'path': '/chart.js:2.5.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:chart.js',
              'version': '2.5.0',
              'path': '/ng2-charts:1.5.0/chart.js:2.5.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:ng2-dragula',
              'version': '1.3.0',
              'path': '/ng2-dragula:1.3.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:dragula',
              'version': '3.7.2',
              'path': '/dragula:3.7.2',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:dragula',
              'version': '3.7.2',
              'path': '/ng2-dragula:1.3.0/dragula:3.7.2',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:ng2-select',
              'version': '1.2.0',
              'path': '/ng2-select:1.2.0',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:symbol-observable',
              'version': '1.0.4',
              'path': '/rxjs:5.2.0/symbol-observable:1.0.4',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:ts-helpers',
              'version': '1.1.2',
              'path': '/ts-helpers:1.1.2',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:zone.js',
              'version': '0.8.5',
              'path': '/zone.js:0.8.5',
              'status': {
                'status': 'ok',
                'obligations': 'O00; O01'
              },
              'requireWhitelist': null,
              'privateLicense': false
            }
          ],
          'status': 'ok'
        },
        {
          'key': 'Unlicense',
          'name': 'The Unlicense',
          'components': [
            {
              'componentKey': 'npm:angular2-text-mask',
              'version': '8.0.0',
              'path': '/angular2-text-mask:8.0.0',
              'status': {
                'status': 'ok',
                'obligations': ''
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:text-mask-core',
              'version': '5.0.1',
              'path': '/angular2-text-mask:8.0.0/text-mask-core:5.0.1',
              'status': {
                'status': 'ok',
                'obligations': ''
              },
              'requireWhitelist': null,
              'privateLicense': false
            },
            {
              'componentKey': 'npm:color-convert',
              'version': '0.5.3',
              'path': '/chart.js:2.5.0/chartjs-color:2.1.0/color-convert:0.5.3',
              'status': {
                'status': 'ok',
                'obligations': ''
              },
              'requireWhitelist': null,
              'privateLicense': false
            }
          ],
          'status': 'ok'
        }
      ],
      'statistics': {
        'licenses': 6,
        'components': 51,
        'legal': {
          'warnings': 1,
          'violations': 4
        },
        'vulnerability': {
          'warnings': 0,
          'violations': 0
        },
        'viability': {
          'warnings': 0,
          'violations': 0
        },
        'integrity': {
          'warnings': 0,
          'violations': 0
        }
      },
      'moduleRequirements': {
        'CA': 'CA_license',
        'OM': 'OM_mop',
        'IP_protect': 'IP_protect_n',
        'IP_enforce': 'IP_enforce_3',
        'TS': 'TS_y',
        'LS': 'LS_pl',
        'D': 'D_ipoa'
      },
      'release': null,
      'latest': true
    }
  }

};

export default DemoData;
