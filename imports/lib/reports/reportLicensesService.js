import _ from 'underscore';
import Utils from '/imports/lib/utils';
import reportServices from '/imports/lib/reports/reportServices';

const reportLicensesService = {};

reportLicensesService.componentVersions = function (component) {
  return reportServices.componentVersions(component)
};

reportLicensesService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportLicensesService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportLicensesService.describeObligations = function (string) {
  const description = Utils.translateObligations(string);
  return description ? description.description : ''
};

reportLicensesService.describeDeadlyObligations = function (string) {
  const description = Utils.translateObligations(string);
  return description ? description.description : ''
};

reportLicensesService.describeViolations = function (string) {
  const description = Utils.translatePermitions(string);
  return description ? description.message : ''
};

reportLicensesService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'LICENSES REPORT',
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
              {text: reportData.stats.licenses, style:'counter', alignment: 'center'},
              {text: reportData.stats.components, style:'counter', alignment: 'center'},
              {text: reportData.stats.obligations, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'licenses', style:'bold', alignment: 'center'},
              {text: 'components', style:'bold', alignment: 'center'},
              {text: 'obligations', style:'bold', alignment: 'center'}
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
    tempReport.content.push({text: 'The following licenses are detected in project:', style: 'subheader'});
    tempReport.content.push({
      style: 'basicTable',
      layout: 'lightHorizontalLines',
      table: {
        widths: [25, '*', '*'],
        headerRows: 1,
        body: [
          [
            {text: '#', style:'bold'},
            {text: 'License', style:'bold'},
            {text: 'Obligation', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (licenseLine, index) {
      let licensePart = [
        {text: index+1, style:'medium'},
        [
          {text: licenseLine.name, style:'mediumBold'},
          {text: licenseLine.label, style:'medium'},
          {text: 'Used in '+reportLicensesService.getPluralized('module',licenseLine.countModules)+' by '+
          reportLicensesService.getPluralized('component',licenseLine.components), style:'small'}
        ],
        {
          table: {
            widths: [40, '*'],
            headerRows: 0,
            body: []
          },
          layout: 'noBorders'
        }
      ];
      if(licenseLine.reason){
        let reason = [
          {
            text: 'Warning',
            style: 'smallBold'
          },
          {
            text: licenseLine.reason,
            style: 'small'
          }
        ];
        licensePart[2].table.body.push(reason)
      }
      _.each(licenseLine.violations, function (violation) {
        let reason = [
          {
            text: 'Violation',
            style: 'smallBold'
          },
          {
            text: reportLicensesService.describeViolations(violation),
            style: 'small'
          }
        ];
        licensePart[2].table.body.push(reason)
      });
      _.each(licenseLine.deadlyObligations, function (obligation) {
        let reason = [
          {
            text: 'Obligation',
            style: 'smallBold'
          },
          {
            text: reportLicensesService.describeDeadlyObligations(obligation),
            style: 'small'
          }
        ];
        licensePart[2].table.body.push(reason)
      });
      _.each(licenseLine.obligations, function (obligation) {
        let reason = [
          {
            text: 'Obligation',
            style: 'smallBold'
          },
          {
            text: reportLicensesService.describeObligations(obligation),
            style: 'small'
          }
        ];
        licensePart[2].table.body.push(reason)
      });
      if(licensePart[2].table.body.length === 0){
        let reason = [
          {
            text: ' ',
            style: 'smallBold'
          },
          {
            text: ' ',
            style: 'small'
          }
        ];
        licensePart[2].table.body.push(reason)
      }
      tempReport.content[tempReport.content.length-1].table.body.push(licensePart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected project no licenses where found.'
    });

  }

  return tempReport
};

reportLicensesService.getJsonDetails = function (reportData) {
  let tempReport =  {
    title: {
      type: 'LICENSES REPORT',
      name: reportData.project.name,
      description: reportServices.projectDescription(reportData.project)
    },
    stats: {
      licenses: reportData.stats.licenses,
      obligations: reportData.stats.obligations,
      components: reportData.stats.components,
      componentViolations: reportData.stats.componentViolations,
      componentWarnings: reportData.stats.componentWarnings
    },
    licenses: []
  };
  if (reportData.list && reportData.list.length){
    _.each(reportData.list, function (licenseLine) {
      let licensePart = {
        name: licenseLine.name,
        status: licenseLine.label,
        usedInModules: licenseLine.countModules,
        usedInComponents: licenseLine.components,
        problems: []
      };
      if(licenseLine.reason){
        let reason = {
          type: 'warning',
          text: licenseLine.reason
        };
        licensePart.problems.push(reason)
      }
      _.each(licenseLine.violations, function (violation) {
        let reason = {
          type: 'violation',
          text: reportLicensesService.describeViolations(violation)
        };
        licensePart.problems.push(reason)
      });
      _.each(licenseLine.deadlyObligations, function (obligation) {
        let reason = {
          type: 'obligation',
          text: reportLicensesService.describeDeadlyObligations(obligation)
        };
        licensePart.problems.push(reason)
      });
      _.each(licenseLine.obligations, function (obligation) {
        let reason = {
          type: 'obligation',
          text: reportLicensesService.describeObligations(obligation)
        };
        licensePart.problems.push(reason)
      });
      tempReport.licenses.push(licensePart);
    });
  }

  return tempReport
};

export default reportLicensesService;
