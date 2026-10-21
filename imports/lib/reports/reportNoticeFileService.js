import _ from 'underscore';
import reportServices from '/imports/lib/reports/reportServices';

const reportNoticeFileService = {};

const LINE_BIG = '**************************************************************************'
const LINE_SHORT = '----------------------------------------'

reportNoticeFileService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

 
reportNoticeFileService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFossFooter(currentPage, pageCount)
    },
    header: function () {
      let header = {
        columns: [
          {
            stack: [
              'NOTICE FILE v.'+reportData.version,
              reportData.getName() + (reportData.release ? ' v.' + reportData.release : '') + (
                ' (' + reportServices.getCurrentDay() + ')')
            ],
            alignment: 'left',
            style: 'marginSidesGrey',
            width: '75%'
          },
          {
            text: ' ',
            width: '75',
            style: 'logoStyles'
          }
        ]
      };
      if(reportServices.companyLogo()){
        header.columns[1] = {
          image: 'companyLogo',
          width: '75',
          style: 'logoStyles'
        }
      }
      return header
    },
    pageSize: 'A4',
    pageMargins: [ 40, 60, 40, 60 ],
    content: [
      {text: reportData.getName()
            + (reportData.release ? ' v.' + reportData.release : ''), style: 'header'},
      {text: reportServices.projectDescription(reportData), style: 'medium'}
    ],
    styles: reportServices.getStyles(),
    images: {
      logo: reportServices.getLogo(),
      companyLogo: reportServices.companyLogo() || reportServices.getLogo()
    }
  };
  if(reportData.binaryLinks && reportData.binaryLinks.length){
    reportData.binaryLinks = _.map(reportData.binaryLinks, function (link) {
      return link.name
    });
    tempReport.content.push(
      {text: reportData.binaryLinks.join(', '), style: 'medium'}
    );
  }
  if (reportData.licenses && reportData.licenses.length){
    tempReport.content.push({
      toc: {
        title: {text: 'Table of content', style: 'subheader'}
      }
    });
  }
  if(reportData.writtenOfferEnabled && reportData.writtenOffer){
    tempReport.content.push({
      style: 'basicTable',
      layout: 'noBorders',
      table: {
        widths: ['*'],
        headerRows: 1,
        body: [
          [
            {text: reportData.writtenOffer.title ? reportData.writtenOffer.title : ' ', style:'subheader', tocItem: true}
          ],
          [
            {text: reportData.writtenOffer.description ? reportData.writtenOffer.description : ' ', style:'medium'}
          ]
        ]
      }
    });
  }
  if (reportData.licenses && reportData.licenses.length){
    _.each(reportData.licenses, function (licenseLine, index) {
      tempReport.content.push({
        style: 'basicTable',
        layout: 'lightHorizontalLines',
        table: {
          widths: [25, '*'],
          headerRows: 1,
          body: [
            [
              {text: index+1, style:'bold'},
              {text: licenseLine.name, style:'bold', tocItem: true}
            ]
          ]
        }
      });
      let componentPart = [
        {text: ''},
        [{text: licenseLine.text  ? licenseLine.text : 'No text provided', style:'medium'},
          {text: 'Components covered', style:'midheader'},
          [{
            table: {
              widths: [5, 250, '*'],
              headerRows: 0,
              body: []
            },
            layout: 'noBorders'
          }]]
      ];
      if (licenseLine.components.length){
        _.each(licenseLine.components, function (componentLine) {
          let component = [
            {text: '*' , style:'medium'},
            {text: componentLine.name +' [v'+ componentLine.version +']', style:'medium'},
            [{
              table: {
                widths: [5, '*'],
                headerRows: 0,
                body: []
              },
              layout: 'noBorders'
            }]
          ];
          if (componentLine.actionsRequired.length) {
            _.each(componentLine.actionsRequired, function (actionLine) {
              let line = [];
              if(actionLine.key === 'Copyright' && componentLine.copyright){
                line = [
                  {text: '-' , style:'medium'},
                  {text: 'Copyright: '+ componentLine.copyright , style:'medium'}
                ]
              }
              if(!componentLine.unchanged){
                if(actionLine.key === 'Modifications' && componentLine.changesUrl){
                  line = [
                    {text: '-' , style:'medium'},
                    {text: 'Find changes at: '+ componentLine.changesUrl, link: componentLine.changesUrl, style:'medium'}
                  ]
                }
                if(actionLine.key === 'ModifiedSources' && componentLine.changedSourcesUrl){
                  line = [
                    {text: '-' , style:'medium'},
                    {text: 'Find changed sources at: '+ componentLine.changedSourcesUrl,
                      link: componentLine.changedSourcesUrl, style:'medium'}
                  ]
                }
                if(actionLine.key === 'ModificationsText' && componentLine.changesText){
                  line = [
                    {text: '-' , style:'medium'},
                    {text: 'Modification notice:  '+ componentLine.changesText,
                      link: componentLine.changesText, style:'medium'}
                  ]
                }
              }
              if(actionLine.key === 'Sources' && componentLine.sourcesUrl){
                line = [
                  {text: '-' , style:'medium'},
                  {text: 'Find sources at: '+ componentLine.sourcesUrl, link: componentLine.sourcesUrl, style:'medium'}
                ]
              }
              if(line.length !== 0){
                component[2][0].table.body.push(line)
              }
            });
          }
          if(component[2][0].table.body.length === 0){
            component[2][0].table.body.push([
              {text: '' , style:'medium'}
            ])
          }
          componentPart[1][2][0].table.body.push(component);
        })
      }
      tempReport.content[tempReport.content.length-1].table.body.push(componentPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected project no licenses where found.'
    });
  }

  return tempReport
};

 
reportNoticeFileService.getMDasTxtDetails = function (reportData) {
  let tempReport =  [
    '#### NOTICE FILE v.'+reportData.version,
    '# ' + reportData.getName()
    + (reportData.release ? ' v.' + reportData.release : '') + (
      ' (' + reportServices.getCurrentDay() + ')'),
    reportServices.projectDescription(reportData)
  ];
  if(reportData.binaryLinks && reportData.binaryLinks.length){
    let binaryLinks = _.map(reportData.binaryLinks, function (link) {
      return link.name
    });
    tempReport.push(binaryLinks.join(', '));
    tempReport.push(
      '\r\n' + LINE_BIG + '\r\n'
    );
  }
  if(reportData.writtenOfferEnabled && reportData.writtenOffer){
    tempReport.push(
      '## ' + ( reportData.writtenOffer.title ? reportData.writtenOffer.title : ' ')
    );
    tempReport.push(
      LINE_SHORT
    );
    tempReport.push(reportData.writtenOffer.description ? reportData.writtenOffer.description : ' ');
    tempReport.push(
      '\r\n' + LINE_BIG + '\r\n'
    );
  }
  if (reportData.licenses && reportData.licenses.length){
    tempReport.push(
      '\r\n' + '## ' + 'Licenses covered:' + '\r\n'
    );
    _.each(reportData.licenses, function (licenseLine, index) {
      tempReport.push('### ' + (+index + 1) + ' - ' + licenseLine.name);
      tempReport.push(
        LINE_SHORT
      );
      tempReport.push(licenseLine.text);
      tempReport.push(
        LINE_SHORT
      );
      if (licenseLine.components.length){
        tempReport.push(
          '#### ' + 'Components covered:' + '\r\n'
        );

        _.each(licenseLine.components, function (componentLine, cIndex) {
          let component = [
            +cIndex + 1,
            componentLine.name +' [v'+ componentLine.version +']'
          ];
          if (componentLine.actionsRequired.length) {
            _.each(componentLine.actionsRequired, function (actionLine) {
              let lines = [];
              if(actionLine.key === 'Copyright' && componentLine.copyright){
                lines.push('Copyright: '+ componentLine.copyright)
              }
              if(!componentLine.unchanged){
                if(actionLine.key === 'Modifications' && componentLine.changesUrl){
                  lines.push('Find changes at: '+ componentLine.changesUrl)
                }
                if(actionLine.key === 'ModifiedSources' && componentLine.changedSourcesUrl){
                  lines.push('Find changed sources at: '+ componentLine.changedSourcesUrl)
                }
                if(actionLine.key === 'ModificationsText' && componentLine.changesText){
                  lines.push('Modification notice:  '+ componentLine.changesText)
                }
              }
              if(actionLine.key === 'Sources' && componentLine.sourcesUrl){
                lines.push('Find sources at: '+ componentLine.sourcesUrl)
              }
              if(lines.length !== 0){
                component.push(lines.join('; '))
              }
            });
          }
          tempReport.push(component.join(' - '));
        })
      }
      tempReport.push(
        '\r\n' + LINE_BIG + '\r\n'
      );
    });
  }else{
    tempReport.push('Sorry, but for the selected project no licenses where found.');
  }

  return tempReport.join('\r\n')
};

export default reportNoticeFileService;
