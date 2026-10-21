import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportCreditsService = {};

reportCreditsService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportCreditsService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};
reportCreditsService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'CREDITS',
              (reportData.module?reportData.module.name:reportData.project.name)
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
      {text: (reportData.module?reportData.module.name:reportData.project.name) +
      (reportData.module?' ('+reportData.project.name+')':''), style: 'header'},
      {text: reportServices.projectDescription(reportData.module?reportData.module:reportData.project), style: 'medium'},
      {
        style: 'basicTable',
        layout: 'lightHorizontalLines',
        table: {
          widths: ['*', '*'],
          headerRows: 1,
          body: [
            [
              {text: reportData.stats.modules, style:'counter', alignment: 'center'},
              {text: reportData.stats.components, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'modules', style:'bold', alignment: 'center'},
              {text: 'different components', style:'bold', alignment: 'center'}
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
    tempReport.content.push({text: 'The following components are detected in '+
    (reportData.module?'module':'project')+':', style: 'subheader'});
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
            {text: '', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (componentLine, index) {
      let copyrightPart = [
        {text: index+1, style:'medium'},
        {
          stack: [
            {text: componentLine.name + (componentLine.version ?' ('+componentLine.version+')' :''), style:'mediumBold'}
          ]
        },
        {
          stack: [
          ]
        }
      ];
      if(componentLine.copyright){
        copyrightPart[2].stack.push({text: componentLine.copyright, style:'mediumBold'});
      }else{
        copyrightPart[2].stack.push({text: 'Copyright not detected', style:'mediumBold'})
      }
      tempReport.content[tempReport.content.length-1].table.body.push(copyrightPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected '+(reportData.module?'module':'project')+' no components where found.'
    });

  }

  return tempReport
};

export default reportCreditsService;
