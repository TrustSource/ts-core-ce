import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportModificationService = {};

reportModificationService.componentVersions = function (component) {
  return '('+component.versions.join(', ')+')'
};

reportModificationService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportModificationService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportModificationService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'MODIFICATION STATE REPORT',
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
          widths: ['*', '*', '*', '*'],
          headerRows: 1,
          body: [
            [
              {text: reportData.stats.componentsTotal, style:'counter', alignment: 'center'},
              {text: reportData.stats.modules, style:'counter', alignment: 'center'},
              {text: reportData.stats.modified, style:'counter', alignment: 'center'},
              {text: reportData.stats.undocumentedChanges, style:'counter', alignment: 'center'}
            ],
            [
              {text: 'different components', style:'bold', alignment: 'center'},
              {text: 'modules', style:'bold', alignment: 'center'},
              {text: 'modified appearances', style:'bold', alignment: 'center'},
              {text: 'undocumented changes', style:'bold', alignment: 'center'}
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
    tempReport.content.push({text: 'The following modification notice of components:', style: 'subheader'});
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
            {text: 'Notice', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (componentLine, index) {
      let componentPart = [
        {text: index+1, style:'medium'},
        [
          {text: componentLine.key, style:'mediumBold'},
          {text: componentLine.versions, style:'mediumBold'},
          {text: reportModificationService.getPluralized('appearance',componentLine.countPath), style:'small'}
        ],
        []
      ];
      _.each(componentLine.paths, function (pathsLine) {
        let path = [
          {text: '*' , style:'medium'},
          {text: pathsLine.path ? pathsLine.path : pathsLine, style:'small'}
        ];
        if(pathsLine.changesUrl){
          path.push({text:'List of changes can be found: '+ pathsLine.changesUrl, style:'small', link: pathsLine.changesUrl})
        }else{
          path.push({text:'Changes url has not been provided', style:'small'})
        }
        if(pathsLine.changesText){
          path.push({text:'Modification notice: '+ pathsLine.changesText, style:'small'})
        }else{
          path.push({text:'Modification notice has not been provided', style:'small'})
        }
        componentPart[2].push(path);
      });
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

export default reportModificationService;
