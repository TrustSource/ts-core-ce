import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportBadAlgorithmsService = {};

reportBadAlgorithmsService.componentVersions = function (component) {
  return '('+component.versions.join(', ')+')'
};

reportBadAlgorithmsService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportBadAlgorithmsService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportBadAlgorithmsService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'All BAD CRYPTO REPORT',
              reportData.company.name
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
      {text: reportData.company.name, style: 'header'},
      {
        style: 'basicTable',
        layout: 'lightHorizontalLines',
        table: {
          widths: ['*', '*', '*', '*', '*', '*'],
          headerRows: 1,
          body: [
            [
              {text: reportData.stats.modules, style:'counter', alignment: 'center'},
              {text: reportData.stats.componentWithAlgorithms, style:'counter', alignment: 'center'},
              {text: reportData.stats.detectedAlgorithms, style:'counter', alignment: 'center'},
              {text: reportData.stats.managedAlgorithms, style:'counter', alignment: 'center'},
              {text: reportData.stats.inUseAlgorithms, style:'counter', alignment: 'center'},
              {text: reportData.stats.coverage, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'modules', style:'bold', alignment: 'center'},
              {text: 'components with algorithms', style:'bold', alignment: 'center'},
              {text: 'detected algorithms', style:'bold', alignment: 'center'},
              {text: 'managed algorithms', style:'bold', alignment: 'center'},
              {text: 'algorithms in use', style:'bold', alignment: 'center'},
              {text: 'coverage %', style:'bold', alignment: 'center'}
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

  if (reportData.list && reportData.list.length){
    tempReport.content.push({text: 'The following algorithms are detected in project:', style: 'subheader'});
    tempReport.content.push({
      style: 'basicTable',
      layout: 'lightHorizontalLines',
      table: {
        widths: [25, '*', '*'],
        headerRows: 1,
        body: [
          [
            {text: '#', style:'bold'},
            {text: 'Projects', style:'bold'},
            {text: 'Algorithms', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (componentLine, index) {
      let componentPart = [
        {text: index+1, style:'medium'},
        {text: componentLine.project.name, style:'mediumBold'},
        {
          table: {
            widths: [5, '*'],
            headerRows: 0,
            body: []
          },
          layout: 'noBorders'
        }
      ];
      _.each(componentLine.algorithms, function (algorithmsLine) {
        let path = [
          {text: '*' , style:'medium'},
          {text: algorithmsLine, style:'small'}
        ];
        componentPart[2].table.body.push(path)
      });
      tempReport.content[tempReport.content.length-1].table.body.push(componentPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected project no algorithms where found.'
    });

  }

  return tempReport
};

reportBadAlgorithmsService.getJsonDetails = function (reportData) {
  let tempReport =  {
    title: {
      type: 'All BAD CRYPTO REPORT',
      name: reportData.company.name
    },
    stats: {
      modules: reportData.stats.modules,
      componentWithAlgorithms: reportData.stats.componentWithAlgorithms,
      detectedAlgorithms: reportData.stats.detectedAlgorithms,
      managedAlgorithms: reportData.stats.managedAlgorithms,
      inUseAlgorithms: reportData.stats.inUseAlgorithms,
      coverage: reportData.stats.coverage
    },
    projects: []
  };
  if (reportData.list && reportData.list.length){
    _.each(reportData.list, function (componentLine) {
      let componentPart = {
        project: componentLine.project.name,
        algorithms: []
      };
      _.each(componentLine.algorithms, function (algorithmsLine) {
        componentPart.algorithms.push(algorithmsLine)
      });
      tempReport.projects.push(componentPart);
    });
  }

  return tempReport
};

export default reportBadAlgorithmsService;
