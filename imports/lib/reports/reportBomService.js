import _ from 'underscore';
import Utils from '/imports/lib/utils';
import reportServices from '/imports/lib/reports/reportServices';
import reportConverter from '/imports/lib/reports/reportConverter';
import {Config} from '/imports/config';

const reportBomService = {};

reportBomService.componentVersions = function (component) {
  return reportServices.componentVersions(component)
};

reportBomService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportBomService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportBomService.describeObligations = function (string) {
  const description = Utils.translateObligations(string);
  return description ? description.description : ''
};

reportBomService.describeDeadlyObligations = function (string) {
  const description = Utils.translateObligations(string);
  return description ? description.description : ''
};

reportBomService.describeViolations = function (string) {
  const description = Utils.translatePermitions(string);
  return description ? description.message : ''
};

reportBomService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'BILL OF MATERIALS',
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
      {text: reportData.company ? `${reportData.company.name}
        ${reportData.company.distribution && reportData.company.distribution.email}`: '', style: 'medium'},
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
      let licensePart = [
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
      if(componentLine.license){
        licensePart[2].stack.push({text: componentLine.license +
            (componentLine.licenseKey ?' ('+componentLine.licenseKey+')' :''), style:'mediumBold'});
        let url;
        if(componentLine.licenseUrl){
          url = {
            text: componentLine.licenseUrl,
            style: 'small'
          };
        }else {
          url = {
            text: Config.appUrl +'licenses/'+componentLine.licenseKey,
            style: 'small'
          };
        }
        licensePart[2].stack.push(url);
      }else{
        licensePart[2].stack.push({text: 'License not detected', style:'mediumBold'})
      }
      tempReport.content[tempReport.content.length-1].table.body.push(licensePart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected '+(reportData.module?'module':'project')+' no components where found.'
    });

  }

  return tempReport
};

// variant: 'SBOM' (default) | 'CBOM' | 'AIBOM' | 'FULL'. 'FULL' maps to the combined
// CycloneDX document (software components + crypto assets + AI artifacts).
reportBomService.getCycloneDxDetails = function (reportData, variant) {
  const company = reportData.company && reportData.company._id ? reportData.company : reportData.company()
  let {_id, name, distribution} = company
  reportData.company = {_id, name, distribution}
  let v = variant === undefined ? 'SBOM' : variant
  if (v === 'FULL') v = undefined          // combined SBOM + CBOM + AIBOM
  return reportConverter.bomToCycloneDX(reportData, v, {format: 'json'})
};

reportBomService.getSPDXDetails = function (reportData) {
  const company = reportData.company && reportData.company._id ? reportData.company : reportData.company()
  let {_id, name, distribution} = company
  reportData.company = {_id, name, distribution}
  return reportConverter.bomToSPDX(reportData, {format: 'json'})
};

export default reportBomService;
