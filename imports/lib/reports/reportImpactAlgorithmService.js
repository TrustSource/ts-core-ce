import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportImpactAlgorithmService = {};

reportImpactAlgorithmService.getPdfDetails = function (reportData) {
  const algorithmTitle = reportData.algorithm.Algorithm + (reportData.algorithm.Strength ? ` [${reportData.algorithm.Strength}]` : '')
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'ALGORITHM IMPACT REPORT',
              algorithmTitle
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
      {text: algorithmTitle, style: 'header'}
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
        widths: [25, '*'],
        headerRows: 3,
        body: [
          [
            {text: '#', style:'bold'},
            {text: 'Project', style:'bold'}
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
        ]
      ];
      tempReport.content[tempReport.content.length-1].table.body.push(projectPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected algorithm impacted project where found.'
    });

  }

  return tempReport
};

export default reportImpactAlgorithmService;
