import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportCotsService = {};

reportCotsService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportCotsService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

 
reportCotsService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'COTS REPORT',
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
          widths: ['*'],
          headerRows: 1,
          body: [
            [
              {text: reportData.stats.components, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'components', style:'bold', alignment: 'center'}
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
    tempReport.content.push({text: 'The following COTS components are detected in project:', style: 'subheader'});
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
            {text: 'Commercial terms', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (componentLine, index) {
      let licensePart = [
        {text: index+1, style:'medium'},
        [
          {text: componentLine.key, style:'mediumBold'},
          {text: componentLine.version, style:'medium'}
        ],
        {
          table: {
            widths: ['*'],
            headerRows: 0,
            body: []
          },
          layout: 'noBorders'
        }
      ];
      if(componentLine.meta && componentLine.meta.urls){
        if(componentLine.meta.urls.homepage){
          let reason = [
            {
              text: 'Homepage: '+componentLine.meta.urls.homepage,
              style: 'small',
              link: componentLine.meta.urls.homepage
            }
          ];
          licensePart[1].push(reason)
        }
        if(componentLine.meta.urls.repository){
          let reason = [
            {
              text: 'Repository: '+componentLine.meta.urls.repository,
              style: 'small',
              link: componentLine.meta.urls.repository
            }
          ];
          licensePart[1].push(reason)
        }
        if(componentLine.meta.urls.issues){
          let reason = [
            {
              text: 'Issues: '+componentLine.meta.urls.issues,
              style: 'small',
              link: componentLine.meta.urls.issues
            }
          ];
          licensePart[1].push(reason)
        }
        if(componentLine.meta.urls.notes){
          let reason = [
            {
              text: 'Release notes: '+componentLine.meta.urls.notes,
              style: 'small',
              link: componentLine.meta.urls.notes
            }
          ];
          licensePart[1].push(reason)
        }
      }
      if(componentLine.meta.provider){
        let reason = [
          {
            text: componentLine.meta.provider + ' / ' +componentLine.meta.providerUrl + ' / '+componentLine.meta.providerAddress,
            style: 'small',
            link: componentLine.meta.providerUrl
          }
        ];
        licensePart[1].push(reason)
      }
      if(componentLine.commercialTerms){
        if(componentLine.commercialTerms.RS){
          let reason = [
            {
              text: 'Right to re-sell '+componentLine.commercialTerms.RS,
              style: 'smallBold'
            }
          ];
          licensePart[2].table.body.push(reason)
        }
        if(componentLine.commercialTerms.D){
          let reason = [
            {
              text: 'Right to distribute '+componentLine.commercialTerms.D,
              style: 'smallBold'
            }
          ];
          licensePart[2].table.body.push(reason)
        }
        if(componentLine.commercialTerms.SA){
          let reason = [
            {
              text: 'Right to host/operate as SaaS '+componentLine.commercialTerms.SA,
              style: 'smallBold'
            }
          ];
          licensePart[2].table.body.push(reason)
        }
        if(componentLine.commercialTerms.M){
          let reason = [
            {
              text: 'Right to modify '+componentLine.commercialTerms.M,
              style: 'smallBold'
            }
          ];
          licensePart[2].table.body.push(reason)
        }
      }
      if(licensePart[2].table.body.length === 0){
        let reason = [
          {
            text: ' ',
            style: 'smallBold'
          }
        ];
        licensePart[2].table.body.push(reason)
      }
      tempReport.content[tempReport.content.length-1].table.body.push(licensePart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected project no COTS components where found.'
    });

  }

  return tempReport
};

export default reportCotsService;
