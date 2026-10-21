import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import reportServices from '/imports/lib/reports/reportServices';

const reportObligationsService = {};

reportObligationsService.componentVersions = function (component) {
  return reportServices.componentVersions(component)
};

reportObligationsService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};

reportObligationsService.getPluralized = function (text,list) {
  return reportServices.getPluralized(text,list)
};

reportObligationsService.getObligationDescription = function (obligationKey) {
  return (Utils.translateObligations(obligationKey) || {}).description || ' '
};

reportObligationsService.getObligationSuggestion = function (obligationKey) {
  return (Utils.translateObligations(obligationKey) || {}).suggestion || ' '
};

reportObligationsService.getObligationComment = function (obligationKey) {
  const project = Projects.findOne(Router.current().params.query.projectId || Router.current().params.projectId);
  const completedObligations = project.getCompletedObligations();
  const oneObligation = _.find(completedObligations,function (completedObligation) {
    return completedObligation.key === obligationKey
  });
  return oneObligation && oneObligation.comment || ' '
};

reportObligationsService.getObligationStatus = function (obligationKey) {
  const project = Projects.findOne(Router.current().params.projectId ||
    (Router.current().params.query && Router.current().params.query.projectId));
  let oneObligation;
  if(project){
    const completedObligations = project.getCompletedObligations();
    oneObligation = _.find(completedObligations,function (completedObligation) {
      return completedObligation.key === obligationKey
    });
  }
  return oneObligation ? 'ok':'warnings'
};

reportObligationsService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'OBLIGATIONS REPORT',
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
      {text: reportServices.projectDescription(reportData.project), style: 'medium'}
    ],
    styles: reportServices.getStyles(),
    images: {
      logo: reportServices.getLogo(),
      trustLogo: reportServices.trustSourceLogo()
    }
  };

  reportServices.extendWithModules(tempReport,reportData);

  if (reportData.list && reportData.list.length){
    tempReport.content.push({text: 'The following obligations are detected in project:', style: 'subheader'});
    tempReport.content.push({
      style: 'basicTable',
      layout: 'lightHorizontalLines',
      table: {
        widths: [15, 35, '*', 300],
        headerRows: 1,
        body: [
          [
            {text: '#', style:'bold'},
            {text: 'Count', style:'bold'},
            {text: 'Obligation', style:'bold'},
            {text: 'Components', style:'bold'}
          ]
        ]
      }
    });
    _.each(reportData.list, function (obligationLine, index) {
      let obligationPart = [
        {text: index+1, style:'medium'},
        {text: obligationLine.count, style:'medium'},
        [
          {text: reportObligationsService.getObligationStatus(obligationLine.key), style:'small'},
          {text: reportObligationsService.getObligationDescription(obligationLine.key), style:'smallBold'},
          {text: reportObligationsService.getObligationSuggestion(obligationLine.key), style:'small'},
          {text: reportObligationsService.getObligationComment(obligationLine.key), style:'smallBold'}
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
      _.each(obligationLine.components, function (component) {
        let reason = [
          [
            {
              text: component.componentKey,
              style: 'smallBold'
            },
            {
              text: component.path,
              style: 'pathStyle'
            }
          ]
        ];
        obligationPart[3].table.body.push(reason)
      });
      if(obligationPart[3].table.body.length === 0){
        let reason = [
          [{
            text: ' ',
            style: 'smallBold'
          },
          {
            text: ' ',
            style: 'small'
          }]
        ];
        obligationPart[3].table.body.push(reason)
      }
      tempReport.content[tempReport.content.length-1].table.body.push(obligationPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'Sorry, but for the selected project no obligations where found.'
    });

  }

  return tempReport
};

export default reportObligationsService;
