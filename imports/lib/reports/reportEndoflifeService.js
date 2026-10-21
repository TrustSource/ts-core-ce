import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportEndoflifeService = {};

reportEndoflifeService.componentVersions = function (component) {
  return '('+component.versions.join(', ')+')'
};

reportEndoflifeService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportEndoflifeService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportEndoflifeService.getPdfDetails = function (reportData) {
  let reportName = (reportData.company && reportData.company.name) ||
    (reportData.project && reportData.project.name)
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'END-OF-LIFE REPORT',
              reportName
            ],
            alignment: 'left',
            style: 'marginSidesGrey',
            width: '75%'
          },
          {
            image: 'logo',
            width: '75',
            style: 'logoStyles'
          }
        ]
      }
    },
    pageSize: 'A4',
    pageMargins: [ 40, 60, 40, 60 ],
    content: [
      {text: reportName, style: 'header'},
      {text: reportData.project ? reportServices.projectDescription(reportData.project): '', style: 'medium'},
      {
        style: 'basicTable',
        layout: 'lightHorizontalLines',
        table: {
          widths: ['*', '*', '*', '*'],
          headerRows: 1,
          body: [
            [
              {text: reportData.stats.componentsTotal, style:'counter', alignment: 'center'},
              {text: reportData.stats.modules, style:'counter', alignment: 'center'},
              {text: reportData.stats.violations, style:'counter', alignment: 'center'},
              {text: reportData.stats.warnings, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'components', style:'bold', alignment: 'center'},
              {text: 'modules', style:'bold', alignment: 'center'},
              {text: 'violations', style:'bold', alignment: 'center'},
              {text: 'warnings', style:'bold', alignment: 'center'}
            ]
          ]
        }
      }
    ],
    styles: reportServices.getStyles(),
    images: {
      logo: reportServices.getLogo(),
      trustLogo: reportServices.trustSourceLogo()
    }
  };

  reportServices.extendWithModules(tempReport,reportData);

  if (reportData.list && reportData.list.length){
    tempReport.content.push({text: 'The following end-of-life problems are detected:', style: 'subheader'});
    tempReport.content.push({
      style: 'basicTable',
      layout: 'lightHorizontalLines',
      table: {
        widths: [25, '*', '*'],
        headerRows: 1,
        body: [
          [
            {text: '#', style:'bold'},
            {text: 'Component', style:'bold'},
            {text: 'Problem', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (componentLine, index) {
      let componentPart = [
        {text: index+1, style:'medium'},
        [
          {text: componentLine.key + ' '+componentLine.versions, style:'mediumBold'},
          {text: reportEndoflifeService.getPluralized('appearance',componentLine.countPath), style:'small'},
          {
            table: {
              widths: [5, '*'],
              headerRows: 0,
              body: []
            },
            layout: 'noBorders'
          }
        ],
        []
      ];
      _.each(componentLine.paths, function (pathsLine) {
        let path = [
          {text: '*' , style:'medium'},
          {text: pathsLine.path ? pathsLine.path : pathsLine, style:'small'}
        ];
        componentPart[1][2].table.body.push(path)
      });
      if (componentLine.problems.length){
        _.each(componentLine.problems, function (problemLine) {
          let problem = [
            {text: problemLine.message, style:'small'}
          ];
          componentPart[2].push(problem);
        })
      }
      tempReport.content[tempReport.content.length-1].table.body.push(componentPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected project no end-of-life problems where found.'
    });

  }

  return tempReport
};

reportEndoflifeService.getJsonDetails = function (reportData) {
  let tempReport =  {
    title: {
      type: 'END-OF-LIFE REPORT',
      name: (reportData.project && reportData.project.name) || (reportData.company && reportData.company.name),
      description: reportData.project ? reportServices.projectDescription(reportData.project) : ''
    },
    stats: {
      components: reportData.stats.componentsTotal,
      modules: reportData.stats.modules,
      affectedComponents: reportData.stats.components,
      violations: reportData.stats.violations,
      warnings: reportData.stats.warnings
    },
    components: []
  };
  if (reportData.list && reportData.list.length){
    _.each(reportData.list, function (componentLine) {
      let componentPart = {
        key: componentLine.key,
        versions: componentLine.versions,
        appearance: componentLine.countPath,
        paths: [],
        information: null,
        status: null
      };
      _.each(componentLine.paths, function (pathsLine) {
        componentPart.paths.push(pathsLine)
      });
      if (componentLine.problems.length){
        _.each(componentLine.problems, function (problemLine) {
          componentPart.information = problemLine.message;
          componentPart.status = problemLine.status;
        })
      }
      tempReport.components.push(componentPart);
    });
  }

  return tempReport
};

export default reportEndoflifeService;
