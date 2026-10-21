import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportVersioningService = {};

reportVersioningService.componentVersions = function (component) {
  return '('+component.versions.join(', ')+')'
};

reportVersioningService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportVersioningService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportVersioningService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'VERSIONING REPORT',
              reportData.project.name
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
      {text: reportData.project.name, style: 'header'},
      {text: reportServices.projectDescription(reportData.project), style: 'medium'},
      {
        style: 'basicTable',
        layout: 'lightHorizontalLines',
        table: {
          widths: ['*', '*', '*'],
          headerRows: 1,
          body: [
            [
              {text: reportData.stats.componentsTotal, style:'counter', alignment: 'center'},
              {text: reportData.stats.modules, style:'counter', alignment: 'center'},
              {text: reportData.stats.components, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'components', style:'bold', alignment: 'center'},
              {text: 'modules', style:'bold', alignment: 'center'},
              {text: 'affected components', style:'bold', alignment: 'center'}
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
    tempReport.content.push({text: 'The following versioning problems are detected in project:', style: 'subheader'});
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
          {text: reportVersioningService.getPluralized('appearance',componentLine.countPath), style:'small'},
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
        _.each(componentLine.problems, function (versioningLine) {
          let problem = [
            {text: 'New version(s) for this component is available.', style:'small'},
            {text: 'Latest version is ' + versioningLine.extra.latest, style:'smallBold'}
          ];
          componentPart[2].push(problem);
        })
      }
      tempReport.content[tempReport.content.length-1].table.body.push(componentPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected project no versioning problems where found.'
    });

  }

  return tempReport
};

reportVersioningService.getJsonDetails = function (reportData) {
  let tempReport =  {
    title: {
      type: 'VERSIONING REPORT',
      name: reportData.project.name,
      description: reportServices.projectDescription(reportData.project)
    },
    stats: {
      components: reportData.stats.componentsTotal,
      modules: reportData.stats.modules,
      affectedComponents: reportData.stats.components
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
        latestVersion: null
      };
      _.each(componentLine.paths, function (pathsLine) {
        componentPart.paths.push(pathsLine)
      });
      if (componentLine.problems.length){
        _.each(componentLine.problems, function (versioningLine) {
          componentPart.latestVersion = versioningLine.extra.latest;
        })
      }
      tempReport.components.push(componentPart);
    });
  }

  return tempReport
};

export default reportVersioningService;
