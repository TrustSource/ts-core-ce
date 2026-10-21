import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportViabilityService = {};

reportViabilityService.componentVersions = function (component) {
  return '('+component.versions.join(', ')+')'
};

reportViabilityService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportViabilityService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportViabilityService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'VIABILITY REPORT',
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
              {text: reportData.stats.components, style:'counter', alignment: 'center'},
              {text: reportData.stats.modules, style:'counter', alignment: 'center'},
              {text: reportData.stats.withoutViability, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'components', style:'bold', alignment: 'center'},
              {text: 'modules', style:'bold', alignment: 'center'},
              {text: 'without viability', style:'bold', alignment: 'center'}
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
    tempReport.content.push({text: 'The following viability information are detected in project:', style: 'subheader'});
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
            {text: 'Viability', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (componentLine, index) {
      let componentPart = [
        {text: index+1, style:'medium'},
        [
          {text: componentLine.key + ' '+_.map(componentLine.versions, function (version) {
            return version.version
          }).join(', '), style:'mediumBold'}
        ],
        []
      ];
      if (componentLine.__viability){
        let viability = componentLine.__viability;
        let problem;
        if(!viability.error){
          problem = [
            {text: 'Forks: ' + viability.forksCnt, style:'small'},
            {text: 'Stars: ' + viability.starsCnt, style:'small'},
            {text: 'Issues: ' + viability.openIssuesCnt, style:'small'}
          ];
        }else{
          problem = [
            {text: viability.error, style:'small'}
          ]
        }
        componentPart[2].push(problem);
      }
      tempReport.content[tempReport.content.length-1].table.body.push(componentPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected project no viability problems where found.'
    });

  }

  return tempReport
};

reportViabilityService.getJsonDetails = function (reportData) {
  let tempReport =  {
    title: {
      type: 'VIABILITY REPORT',
      name: reportData.project.name,
      description: reportServices.projectDescription(reportData.project)
    },
    stats: {
      components: reportData.stats.components,
      modules: reportData.stats.modules,
      withoutViability: reportData.stats.withoutViability
    },
    components: []
  };
  if (reportData.list && reportData.list.length){
    _.each(reportData.list, function (componentLine) {
      let componentPart = {
        key: componentLine.key,
        versions: _.map(componentLine.versions, function (version) {
          return version.version
        }),
        viability: []
      };
      if (componentLine.__viability){
        componentPart.viability = componentLine.__viability;
      }
      tempReport.components.push(componentPart);
    });
  }else{
    tempReport.error = 'Sorry, but for the selected project no vulnerabilities where found.'
  }

  return tempReport
};

export default reportViabilityService;
