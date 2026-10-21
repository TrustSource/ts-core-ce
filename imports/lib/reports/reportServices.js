import {Meteor} from 'meteor/meteor';
import {moment} from 'meteor/momentjs:moment';
import _ from 'underscore';
import Pluralize from 'pluralize';
import Projects from '/imports/lib/collections/projects';
import Companies from '/imports/lib/collections/companies';
import {Config} from '/imports/config';

const reportServices = {};

reportServices.getCurrentTime = function () {
  return moment(new Date()).format('DD/MM/YY HH:mm');
};
reportServices.getCurrentDay = function () {
  return moment(new Date()).format('DD/MM/YY');
};
reportServices.getMyUsername = function () {
  const user = Meteor.user();
  if (user) {
    if (user.profile && user.profile.name) {
      return user.profile.name;
    }
    if (user.name) {
      return user.name;
    }
    if (user.emails && user.emails[0] && user.emails[0].address) {
      return user.emails[0].address;
    }
    if  (user.profile.email){
      return user.profile.email
    }
  }
  return 'anonymous';
};

reportServices.componentVersions = function (component) {
  let versions = _.map(component.versions, function (version) {
    return version.version
  });
  return '('+versions.join(', ')+')'
};

reportServices.projectDescription = function (project) {
  const entityType = project.projectId ? 'module' : 'project';
  const MAX_DESCRIPTION_LENGTH = 500;
  let descriptionOrDefault = project.description ? project.description : 'No goals mentioned in ' + entityType + ' settings.';
  if (descriptionOrDefault.length > MAX_DESCRIPTION_LENGTH) {
    descriptionOrDefault = descriptionOrDefault.slice(0, MAX_DESCRIPTION_LENGTH) + '... (truncated - see full text in project settings)';
  }
  return project && Projects.UNASSIGNED !== project._id ? descriptionOrDefault : ''
};

reportServices.getPluralized = function (text,list) {
  return Pluralize(text, list && list.length || list, true)
};

reportServices.extendWithModules = function (tempReport, reportData) {
  if (reportData.modules && reportData.modules.length) {
    tempReport.content.push({
      style: 'basicTable',
      layout: 'lightHorizontalLines',
      table: {
        widths: [25, '*', '*'],
        headerRows: 1,
        body: [
          [
            {text: '#', style:'bold'},
            {text: 'Used modules', style:'bold'},
            {text: 'Details', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.modules, function (moduleLine, index) {
      let licensePart = [
        {text: index+1, style:'medium'},
        {
          stack: [
            {text: moduleLine.name + (moduleLine.version ?' ('+moduleLine.version+')' :''), style:'mediumBold'}
          ]
        },
        {
          stack: [
          ]
        }
      ];
      if(moduleLine.analysis){
        let detailPart = [];
        if(moduleLine.analysis.date) {
          detailPart.push(moment(moduleLine.analysis.date).format('lll'))
        }
        if(moduleLine.analysis.branch) {
          detailPart.push('Branch: ' + moduleLine.analysis.branch);
        }
        if(moduleLine.analysis.tag) {
          detailPart.push('Tag: ' + moduleLine.analysis.tag);
        }
        if(moduleLine.analysis.release) {
          detailPart.push('Analysis tag: ' + moduleLine.analysis.release);
        }
        if(detailPart.length){
          licensePart[2].stack.push({text: detailPart.join('; '), style:'mediumBold'});
        }
      }
      tempReport.content[tempReport.content.length-1].table.body.push(licensePart);
    });
  }
};

reportServices.getFooter = function (currentPage, pageCount) {
  return {
    columns: [
      {
        width: '43%',
        layout: 'noBorders',
        table: {
          widths: [70,'*'],
          headerRows: 0,
          body: [
            [
              {
                image: 'trustLogo',
                fit: [50, 70],
                style: 'footerLogoStyles'
              },
              {
                text: Config.appUrl,
                link: Config.appUrl,
                alignment: 'left',
                style: 'marginSidesGreyUrl'
              }
            ]
          ]
        }
      },
      {
        text: 'page ' + currentPage.toString() + ' of ' + pageCount,
        alignment: 'center',
        style: 'marginMiddleColumnGrey',
        width: '14%'
      },
      {
        stack: [
          'As of: ' + reportServices.getCurrentTime(),
          'Produced by: ' + reportServices.getMyUsername()
        ],
        alignment: 'right',
        style: 'marginSidesGrey',
        width: '43%'
      }
    ]
  }
};

reportServices.getFossFooter = function (currentPage, pageCount) {
  const user = Meteor.user();
  const company = Companies.findOne(user.profile.companyId);
  let FOSS = {};
  if(company && company.foss){
    FOSS = company.foss
  }
  return {
    columns: [
      {
        stack: [
          {
            text: FOSS.url,
            link: FOSS.url
          }
        ],
        alignment: 'left',
        style: 'marginSidesGrey',
        width: '43%'
      },
      {
        text: 'page ' + currentPage.toString() + ' of ' + pageCount,
        alignment: 'center',
        style: 'marginMiddleColumnGrey',
        width: '14%'
      },
      {
        stack: [
          (FOSS.email)?'for inquiries contact our FOSS liaison:':' ',
          {
            text: FOSS.email,
            link: FOSS.email
          }
        ],
        alignment: 'right',
        style: 'marginSidesGrey',
        width: '43%'
      }
    ]
  }
};

reportServices.getStyles = function () {
  return {
    header: {
      fontSize: 18,
      bold: true,
      margin: [0, 0, 0, 10]
    },
    subheader: {
      fontSize: 12,
      bold: true,
      margin: [0, 10, 0, 5]
    },
    midheader: {
      fontSize: 11,
      bold: true,
      margin: [0, 10, 0, 5]
    },
    bold: {
      bold: true
    },
    medium: {
      fontSize: 9
    },
    mediumBold: {
      fontSize: 9,
      bold: true
    },
    mediumDetails: {
      fontSize: 9,
      margin: [5, 0, 0, 0]
    },
    small: {
      fontSize: 7
    },
    smallBold: {
      fontSize: 7,
      bold: true
    },
    smallDetails: {
      fontSize: 7,
      margin: [5, 0, 0, 0]
    },
    basicTable: {
      margin: [0, 5, 0, 15]
    },
    margins: {
      margin: [0, 10, 0, 0]
    },
    boldMedium: {
      bold: true,
      fontSize: 9
    },
    marginSides: {
      margin: [40, 20, 40, 0]
    },
    marginSidesGrey: {
      margin: [40, 20, 40, 0],
      color: '#999999',
      fontSize: 9
    },
    marginSidesGreyUrl: {
      margin: [20, 30, 0, 0],
      color: '#999999',
      fontSize: 9
    },
    marginMiddleColumn: {
      margin: [0, 40, 0, 0]
    },
    marginMiddleColumnGrey: {
      margin: [0, 30, 0, 0],
      color: '#999999',
      fontSize: 9
    },
    counter: {
      margin: [0, 10, 0, 0],
      fontSize: 18,
      bold: true
    },
    logoStyles: {
      margin: [40, 20, 40, 0]
    },
    footerLogoStyles: {
      margin: [40, 20, 0, 0]
    },
    pathStyle: {
      fontSize: 8
    },
    // Vulnerability report CVSS vs EPSS scatter chart disclaimer -
    // see imports/lib/reports/reportVulnerabilityService.js.
    epssDisclaimer: {
      fontSize: 8,
      italics: true,
      color: '#999999'
    }
  }
};

reportServices.companyLogo = function () {
  const user = Meteor.user();
  const company = Companies.findOne(user.profile.companyId);
  return company && company.logoBase64 || false

};

reportServices.getLogo = function () {
  const user = Meteor.user();
  const company = Companies.findOne(user.profile.companyId);
  const logoBase64 = company && company.logoBase64;
  return logoBase64 || reportServices.trustSourceLogo()

};

reportServices.trustSourceLogo = function () {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABbCAYAAAA2qspzAAAAAXNSR0IArs4c6QAAAAlwSFlzAAAuIwA' +
    'ALiMBeKU/dgAAActpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs' +
    '9IlhNUCBDb3JlIDUuNC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXg' +
    'tbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUu' +
    'Y29tL3hhcC8xLjAvIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyI+CiAgICAgICAgIDx4b' +
    'XA6Q3JlYXRvclRvb2w+QWRvYmUgSW1hZ2VSZWFkeTwveG1wOkNyZWF0b3JUb29sPgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90a' +
    'WZmOk9yaWVudGF0aW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KKS7NPQAAQABJREFUe' +
    'AHtnQmc1VXd/3/L3WZgQFRUNPe2B3osweqxRQYtc2EAq6EnK5VFaLVs35SLtj7mkqYpAub2WE4KDC5pJhdNzWzAFqzMzIVHU1SE2e7yW/7vz' +
    '/nd33Dnzh3WAUf/c14z97ed/Xy/57uec2xrKAz1QK0eyGYdK5sNDjspu1fCd+50kqm3Bl7Jt6zQIbpdK8lr4V1oWQGNcxw3ZQVe8cbXbENfC' +
    '4P1yrYhBDYMeIQTpp4z27KdK1WfMAxAEst9Zeu2M0u3S04imQQ5nqf5J2g2GApDPVCjB+wQCmIwJJ8Krgmt4G7HTSqe3gU1ErwWXvm0Lskso' +
    'EYuXrX07LYhBHktDOvOakM2KyRx1rRki0Fon+97Bc92XMEMnMhrLTAh0C5XrJVfeiQIg0vUwiEEea2N88C2pwcRHl521m1hGLY4TiKGm9cYFQ' +
    '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' +
    'gAAAABJRU5ErkJggg=='
};

export default reportServices;
