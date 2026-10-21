import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportImpactComponentService = {};

reportImpactComponentService.getPdfDetails = function (reportData) {
  const componentTitle = reportData.component.name + (reportData.component.version ? ` [${reportData.component.version}]` : '')
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'COMPONENT IMPACT REPORT',
              componentTitle
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
      {text: componentTitle, style: 'header'},
      {text: reportData.component.description, style: 'medium'}
    ],
    styles: reportServices.getStyles(),
    images: {
      logo: reportServices.getLogo(),
      trustLogo: reportServices.trustSourceLogo()
    }
  };
  if (reportData.list && reportData.list.length){
    tempReport.content.push({text: 'The following impacted projects are detected:', style: 'subheader'});
    tempReport.content.push({
      style: 'basicTable',
      layout: 'lightHorizontalLines',
      table: {
        widths: [25, '*', '*'],
        headerRows: 3,
        body: [
          [
            {text: '#', style:'bold'},
            {text: 'Project', style:'bold'},
            {text: 'Modules', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (projectLine, index) {
      let projectPart = [
        {text: index+1, style:'medium'},
        [
          {text: projectLine.name, style:'mediumBold'},
          {text: projectLine.description, style:'small'}
        ],
        []
      ];
      if (projectLine.modules.length){
        projectPart[2] = [
          {
            table: {
              widths: [10, '*'],
              headerRows: 0,
              body: []
            },
            layout: 'noBorders'
          }
        ]
        projectLine.modules = _.each(projectLine.modules, function (moduleLine) {
          let modulePart = [
            {text: '*', style:'medium'},
            {text: moduleLine.name, style:'medium'}
          ]
          projectPart[2][0].table.body.push(modulePart)
        });
      }
      tempReport.content[tempReport.content.length-1].table.body.push(projectPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected component impacted project where found.'
    });

  }

  return tempReport
};

export default reportImpactComponentService;
