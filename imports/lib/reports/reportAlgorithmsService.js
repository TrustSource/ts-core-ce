import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportAlgorithmsService = {};

reportAlgorithmsService.componentVersions = function (component) {
  return '('+component.versions.join(', ')+')'
};

reportAlgorithmsService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportAlgorithmsService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportAlgorithmsService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'ALGORITHMS REPORT',
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
          widths: ['*', '*'],
          headerRows: 1,
          body: [
            [
              {text: reportData.stats.modules, style:'counter', alignment: 'center'},
              {text: reportData.stats.componentWithAlgorithms, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'modules', style:'bold', alignment: 'center'},
              {text: 'components with algorithms', style:'bold', alignment: 'center'}
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
            {text: 'Component', style:'bold'},
            {text: 'Algorithms', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (componentLine, index) {
      let componentPart = [
        {text: index+1, style:'medium'},
        {text: componentLine.key, style:'mediumBold'},
        {
          table: {
            widths: [5, '*'],
            headerRows: 0,
            body: []
          },
          layout: 'noBorders'
        }

      ];
      _.each(componentLine.crypto_algorithms, function (algorithmsLine) {
        let path = [
          {text: '*' , style:'medium'},
          {text: algorithmsLine.algorithm ? algorithmsLine.algorithm + `[${algorithmsLine.strength}]` : algorithmsLine, style:'small'}
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

reportAlgorithmsService.getJsonDetails = function (reportData) {
  let tempReport =  {
    title: {
      type: 'ALGORITHMS REPORT',
      name: reportData.project.name,
      description: reportServices.projectDescription(reportData.project)
    },
    stats: {
      modules: reportData.stats.modules,
      componentWithAlgorithms: reportData.stats.componentWithAlgorithms
    },
    components: []
  };
  if (reportData.list && reportData.list.length){
    _.each(reportData.list, function (componentLine) {
      let componentPart = {
        key: componentLine.key,
        algorithms: []
      };
      _.each(componentLine.crypto_algorithms, function (algorithmsLine) {
        componentPart.algorithms.push(algorithmsLine)
      });
      tempReport.components.push(componentPart);
    });
  }

  return tempReport
};

export default reportAlgorithmsService;
