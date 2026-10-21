import _ from 'underscore';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import reportServices from '/imports/lib/reports/reportServices';
import Utils from '/imports/lib/utils';

function buildVulnerabilityRows(moduleLine, modulePart) {
  _.each(moduleLine.vulnerability, function (componentLine, index) {
    let component = [
      {text: index+1 ,rowSpan: componentLine.paths.length, style:'medium'},
      {text: componentLine.key + ' '+reportCveService.componentVersions(componentLine), style:'medium'}
    ];
    modulePart[2].table.body.push(component);
    if (componentLine.paths.length){
      _.each(componentLine.paths, function (pathsLine) {
        let path = [
          {text: '*' ,rowSpan: componentLine.paths.length, style:'medium'},
          {text: pathsLine, style:'small'}
        ];
        modulePart[2].table.body.push(path)
      })
    }
  })
}

const reportCveService = {};

reportCveService.getCveVector = function (cve) {
  if(cve.impact){
    const impact = Utils.groupedImpactVersions(cve.impact)
    return impact && ((impact.cvss3 && impact.cvss3.vectorString) ||
      (impact.cvss2 && impact.cvss2.vectorString));
  }
  return 'No vector available'
};

reportCveService.getCveScore = function (cve) {
  return cve.cvssScore && cve.cvssScore.toFixed(1) || cve.severity;
};

reportCveService.getCveColor = function (cve) {
  const score = cve.cvssScore|| cve.severity;
  if (score) {
    if(score > 9 || score === 'critical'){
      return 'red'
    }else if(score > 7 || score === 'high'){
      return 'orange'
    }else if(score > 4 || score === 'moderate'){
      return 'yellow'
    }else if(score > 0 || score === 'low'){
      return 'green-yellow'
    }
  }
  return 'green';
};

reportCveService.moduleArchitectureType = function (type) {
  if (type) {
    const types = [
      {label: 'Frontend-UI-Module', value: 'FEU'},
      {label: 'Frontend-Endpoint', value: 'FEE'},
      {label: 'Frontend-Service', value: 'FES'},
      {label: 'Backend-Service', value: 'BES'},
      {label: 'Backend-Endpoint', value: 'BEE'},
      {label: 'System component', value: 'SC'},
      {label: 'Infrastructure Service', value: 'IS'},
      {label: 'Distributable Component', value: 'DC'}
    ];
    let item = _.find(types, function (item) {
      return item.value === type
    });
    return item.label;
  }else {
    return ''
  }
};

reportCveService.componentVersions = function (component) {
  return '('+component.versions.join(', ')+')'
};

reportCveService.projectDescription = function (project) {
  return reportServices.projectDescription(project)
};


reportCveService.getPdfDetails = function (reportData) {
  let tempReport =  {
    footer: function (currentPage, pageCount) {
      return reportServices.getFooter(currentPage, pageCount)
    },
    header: function () {
      return {
        columns: [
          {
            stack: [
              'IMPACT REPORT',
              reportData.cveDetails.name
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
      {text: reportData.cveDetails.name, style: 'header'},
      {text: reportData.cveDetails.description, style: 'medium'},
      {text: 'CVSS Base Score: ' + reportCveService.getCveScore(reportData.cveDetails), style: 'margins'},
      {
        text: 'Attack vector: '+reportCveService.getCveVector(reportData.cveDetails),
        style: 'margins'
      },
      {text: 'More information: ' + reportData.cveDetails.link, style: 'margins'}
    ],
    styles: reportServices.getStyles(),
    images: {
      logo: reportServices.getLogo(),
      trustLogo: reportServices.trustSourceLogo()
    }
  };

  if (reportData.list.length){
    tempReport.content.push({text: 'The following projects are impacted by the CVE:', style: 'subheader'});
    tempReport.content.push({
      style: 'basicTable',
      layout: 'lightHorizontalLines',
      table: {
        widths: [15, 110, '*'],
        headerRows: 1,
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
      let project = projectLine.project;
      let projectPart = [
        {text: index+1, style:'medium'},
        {
          table: {
            widths: ['*'],
            headerRows: 0,
            body: [
              [
                {text: project.name, style:'medium'}
              ],
              [
                {text: reportCveService.projectDescription(project), style:'small'}
              ]
            ]
          },
          layout: 'noBorders'
        },
        [{
          layout: 'lightHorizontalLines',
          table: {
            widths: [15, 110, '*'],
            headerRows: 1,
            body: [
              [
                {text: '#', style:'boldMedium'},
                {text: 'Module', style:'boldMedium'},
                {text: 'Components', style:'boldMedium'}
              ]
            ]
          }
        }]
      ];
      if (projectLine.modules.length){
        projectLine.modules = _.map(projectLine.modules, function (moduleLine, index) {
          let modulePart = [
            {text: index+1, style:'medium'},
            {
              table: {
                widths: ['*'],
                headerRows: 0,
                body: [
                  [
                    {text: moduleLine.module, style:'medium'}
                  ],
                  [
                    {text: reportCveService.moduleArchitectureType(moduleLine.moduleArchitectureType), style:'small'}
                  ]
                ]
              },
              layout: 'noBorders'
            },
            {
              table: {
                widths: [5, '*'],
                headerRows: 0,
                body: []
              },
              layout: 'noBorders'
            }
          ];
          if (moduleLine.vulnerability.length){
            buildVulnerabilityRows(moduleLine, modulePart);
          }
          return modulePart
        });
        _.each(projectLine.modules, function (moduleLine) {
          projectPart[2][0].table.body.push(moduleLine)
        })
      }
      tempReport.content[tempReport.content.length-1].table.body.push(projectPart);
    });
  }else{
    tempReport.content.push({
      style: 'subheader',
      text: 'The selected CVE does not impact any of your listed components.'
    });

  }

  return tempReport
};

reportCveService.getJsonDetails = function (reportData) {
  let tempReport =  {
    title: {
      type: 'IMPACT REPORT',
      name: reportData.cveDetails.name,
      description: reportData.cveDetails.description,
      score: reportCveService.getCveScore(reportData.cveDetails),
      vector: reportCveService.getCveVector(reportData.cveDetails),
      link: Router.url('vlCveByName', null, {query:{filter:  JSON.stringify({cve: reportData.cveDetails.name})}})
    },
    projects: []
  };
  if (reportData.list && reportData.list.length){
    _.each(reportData.list, function (projectLine) {
      let project = projectLine;
      let projectPart = {
        _id: project._id,
        name: project.name,
        description: reportCveService.projectDescription(project),
        modules: []
      };
      if (projectLine.modules.length){
        projectLine.modules = _.map(projectLine.modules, function (moduleLine) {
          let modulePart = {
            _id: moduleLine._id,
            name: moduleLine.name,
            architectureType: reportCveService.moduleArchitectureType(moduleLine.moduleArchitectureType),
            link: Router.url('moduleDependencies', {projectId:project._id,moduleId:moduleLine._id},
              {query:{analysis:  moduleLine.analysis && moduleLine.analysis._id}})
          };
          if (moduleLine.vulnerability && moduleLine.vulnerability.length){
            _.each(moduleLine.vulnerability, function (componentLine) {
              let component = {
                key: componentLine.key,
                versions: componentLine.versions,
                paths: componentLine.paths
              };
              modulePart.components.push(component);
            })
          }
          return modulePart
        });
        _.each(projectLine.modules, function (moduleLine) {
          projectPart.modules.push(moduleLine)
        })
      }
      tempReport.projects.push(projectPart);
    });
  }
  return tempReport
};

export default reportCveService;
