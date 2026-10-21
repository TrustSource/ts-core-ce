import _ from 'underscore';
import {Config} from '/imports/config';
import reportServices from '/imports/lib/reports/reportServices';
import reportConverter from './reportConverter';
import Utils from '../utils';

const reportSbomFileService = {};

reportSbomFileService.componentVersions = function (component) {
  return reportServices.componentVersions(component)
};

reportSbomFileService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportSbomFileService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportSbomFileService.describeObligations = function (string) {
  const description = Utils.translateObligations(string);
  return description ? description.description : ''
};

reportSbomFileService.describeDeadlyObligations = function (string) {
  const description = Utils.translateObligations(string);
  return description ? description.description : ''
};

reportSbomFileService.describeViolations = function (string) {
  const description = Utils.translatePermitions(string);
  return description ? description.message : ''
};

 
reportSbomFileService.getPdfDetails = function (reportData) {
  let module = reportData.module && reportData.module()
  let project = reportData.project && reportData.project()
  // company may already be resolved to a plain object (the CycloneDX/SPDX
  // exports reassign reportData.company to {_id, name, distribution}); only
  // call it when it is still the unresolved accessor function.
  let company = reportData.company && (reportData.company._id ? reportData.company : reportData.company())
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'SOFTWARE BILL OF MATERIALS v.'+reportData.version,
              (module?module.name:project.name)
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
      {text: (module?module.name:project.name) +
          (module?' ('+project.name+')':''), style: 'header'},
      {text: reportServices.projectDescription(module?module:project), style: 'medium'},
      {text: company ? `${company.name}
        ${company.distribution && company.distribution.email}`: '', style: 'medium'},
      {
        style: 'basicTable',
        layout: 'lightHorizontalLines',
        table: {
          widths: ['*'],
          headerRows: 1,
          body: [
            [
              {text: reportData.components, style:'counter', alignment: 'center'}
            ],
            [
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
        (module?'module':'project')+':', style: 'subheader'});
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
            text: `License url: ${componentLine.licenseUrl}`,
            style: 'small'
          };
        }else {
          url = {
            text: `License url: ${Config.appUrl +'licenses/'+componentLine.licenseKey}`,
            style: 'small'
          };
        }
        licensePart[2].stack.push(url);
      }else{
        licensePart[2].stack.push({text: 'License not detected', style:'mediumBold'})
      }
      if(componentLine.copyrightText){
        licensePart[2].stack.push({
          text: `Copyright text: ${componentLine.copyrightText}`,
          style: 'small'
        });
      }
      if(componentLine.summary){
        licensePart[1].stack.push({
          text: `Summary: ${componentLine.summary}`,
          style: 'small'
        });
      }
      if(componentLine.packageFileName){
        licensePart[1].stack.push({
          text: `Package file name: ${componentLine.packageFileName}`,
          style: 'small'
        });
      }
      if(componentLine.sourceInfo){
        licensePart[1].stack.push({
          text: `Source info: ${componentLine.sourceInfo}`,
          style: 'small'
        });
      }
      if(componentLine.originator){
        licensePart[1].stack.push({
          text: `Originator: ${componentLine.originator}`,
          style: 'small'
        });
      }
      if(componentLine.supplier){
        licensePart[1].stack.push({
          text: `Supplier: ${componentLine.supplier}`,
          style: 'small'
        });
      }
      if(componentLine.downloadLocation){
        licensePart[1].stack.push({
          text: `Download location: ${componentLine.downloadLocation}`,
          style: 'small'
        });
      }
      if(componentLine.hashOfExecutable){
        licensePart[1].stack.push({
          text: `Hash of executable: ${componentLine.hashOfExecutable}`,
          style: 'small'
        });
      }
      if(componentLine.homepageUrl){
        licensePart[2].stack.push({
          text: `Homepage url: ${componentLine.homepageUrl}`,
          style: 'small'
        });
      }
      if(componentLine.repoUrl){
        licensePart[2].stack.push({
          text: `Repo url: ${componentLine.repoUrl}`,
          style: 'small'
        });
      }
      if(componentLine.sourceUrl){
        licensePart[2].stack.push({
          text: `Source url: ${componentLine.sourceUrl}`,
          style: 'small'
        });
      }
      if(componentLine.hashOfSource){
        licensePart[2].stack.push({
          text: `Hash of source: ${componentLine.hashOfSource}`,
          style: 'small'
        });
      }
      if(componentLine.binaryUrl){
        licensePart[2].stack.push({
          text: `Binary url: ${componentLine.binaryUrl}`,
          style: 'small'
        });
      }
      if(componentLine.other){
        licensePart[2].stack.push({
          text: `Other: ${componentLine.other}`,
          style: 'small'
        });
      }
      tempReport.content[tempReport.content.length-1].table.body.push(licensePart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected '+(module?'module':'project')+' no components where found.'
    });

  }

  return tempReport
};


reportSbomFileService.getCycloneDxDetails = function (reportData, type) {
  const company = reportData.company && reportData.company._id ? reportData.company : reportData.company()
  let {_id, name, distribution} = company
  reportData.company = {_id, name, distribution}
  return reportConverter.bomToCycloneDX(reportData, type, {format: 'json'})
};

reportSbomFileService.getSPDXDetails = function (reportData) {
  const company = reportData.company && reportData.company._id ? reportData.company : reportData.company()
  let {_id, name, distribution} = company
  reportData.company = {_id, name, distribution}
  return reportConverter.bomToSPDX(reportData, {format: 'json'})
};
export default reportSbomFileService;
