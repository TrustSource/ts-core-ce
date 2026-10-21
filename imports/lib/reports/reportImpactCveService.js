import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportImpactCveService = {};

reportImpactCveService.getPdfDetails = function (reportData) {
  const componentTitle = reportData.cveDetails.name
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'CVE IMPACT REPORT',
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
      {text: reportData.cveDetails && reportData.cveDetails.description || ' ', style: 'medium'}
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
        widths: [25, '*', '*', '*'],
        headerRows: 1,
        body: [
          [
            {text: '#', style:'bold'},
            {text: 'Project', style:'bold'},
            {text: 'Modules', style:'bold'},
            {text: '', style:'bold'}
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
        [],
        []
      ];
      if (projectLine.modules && projectLine.modules.length){
        projectPart[2] = [
          {
            table: {
              widths: [5, '*'],
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
          if (moduleLine.cveConfig && moduleLine.cveConfig.length) {
            projectPart[3] = [
              {
                table: {
                  widths: [5, '*'],
                  headerRows: 0,
                  body: []
                },
                layout: 'noBorders'
              }
            ]
            moduleLine.cveConfig = _.each(moduleLine.cveConfig, function (cveLine) {
              let commentPart = [
                {text: '-', style: 'medium'},
                {text: cveLine.comment || ' ', style: 'medium'}
              ]
              projectPart[3][0].table.body.push(commentPart)
            });
          }
        });
      }
      tempReport.content[tempReport.content.length-1].table.body.push(projectPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected CVE ID impacted project where found.'
    });

  }

  return tempReport
};

export default reportImpactCveService;
