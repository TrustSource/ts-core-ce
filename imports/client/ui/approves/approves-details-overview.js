import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Spacebars} from 'meteor/spacebars';
import _ from 'underscore';
import {moment} from 'meteor/momentjs:moment';
import Module from '/imports/lib/project/Module';
import {escapeHtml, metaChip} from '/imports/lib/html/tableCells';

function filteredModules(approve, projectId, iteration) {

  let modules = Session.get('modulesByProject');
  if(!modules || (modules && modules.length === 0)){
    Meteor.setTimeout(()=>{
      filteredModules(approve, projectId,(iteration || 0)+1)
    },(iteration*1000))
  }else{
    let result = [];
    let modulesFiltered = modules.filter((module)=>{
      return approve.getModuleIds().indexOf(module._id) > -1
    })
    modulesFiltered.forEach(m => {
      let p = new Module(m)
      p.analysisId = approve.getModuleAnalysis(p._id);
      p.analysisObj = p.getAnalysis(approve.getModuleAnalysis(null, p.analysisId));
      if(p.properties && p.properties.architecture === 'infrastructureModule'){
        let template =  _.find(Session.get('infrastructureTemplates'),function (item) {
          return item.key === 'im:' + p.moduleIdentifier
        });
        p.crawlerInfo = template && template.crawlerInfo
      }
      if(p.moduleIdentifier && p.moduleIdentifier.indexOf('im:') === -1){
        result.push(p);
      }
    });
    result = _.map(result, function (m) {
      return new Module(m)
    });
    let changedComponents = [];
    _.each(result, function (module) {
      let changeSet = [];
      changeSet.push(module.getChangedStatusComponents());
      changeSet.push(module.getWhitelistedCve());
      changeSet = _.map(_.flatten(changeSet), function (change) {
        let safeObject = Object.create(null);
        let newChange = Object.assign(safeObject, change);
        newChange.moduleId = module._id;
        newChange.projectId = projectId;
        newChange.analysisId = module.analysisId;
        newChange.moduleName = module.getName();
        return newChange
      });
      changedComponents.push(changeSet);
    });
    changedComponents = _.sortBy(_.flatten(changedComponents), p => p.key);
    Session.set('approveChangedComponents'+projectId,changedComponents);
    return result;
  }
}

Template.approvesDetailsOverview.helpers({
  getNoticeOptions: function () {
    return {noticeId: this.noticeFileId}
  },

  reactiveTableModules: function () {
    let approve = this;
    return {
      collection: filteredModules(approve, approve.projectId) || [],
      rowsPerPage: 15,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'state',
          key: 'state',
          label: 'State',
          fn: function (value, object) {
            const icons = {ok: 'fa-check-circle', warnings: 'fa-exclamation-triangle', violations: 'fa-times-circle'};
            let state = value;
            if (object.getStatistics) {
              state = object.getStatistics(approve.getModuleAnalysis(object._id)).getState();
            }
            const icon = icons[state] || 'fa-question-circle';
            return new Spacebars.SafeString('<span class="label label-fw bg-' + state + '" sort=' + state + ' title="' + state + '">' +
              '<span class="fa ' + icon + '"></span></span>');
          },
          cellClass: 'col-state'
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          sortOrder: 0,
          sortDirection: 'ascending',
          tmpl: Template.reactiveTableModulesNameTargetBlank
        },
        {
          fieldId: 'analysisId',
          key: 'analysisId',
          label: 'Analysis',
          fn: function (value, object) {
            let module = approve.getModule(object._id);
            if (module) {
              let list = [];
              if (module.date) {
                list.push('<span class="fa fa-clock-o inner-r-5" title="Date"></span><span>' +
                  moment(module.date).format('lll') + '</span>')
              }
              // Branch, tag, version and release are stored scan text: escaped by
              // metaChip, since this cell returns markup.
              if (module.branch) {
                list.push(metaChip('fa-code-fork', 'Branch', module.branch))
              }
              if (module.tag) {
                list.push(metaChip('fa-tag', 'Tag', module.tag))
              }
              if (module.version) {
                list.push('Version: <span>' + escapeHtml(module.version) + '</span>')
              }
              if (module.release) {
                list.push(metaChip('fa-snowflake-o', 'Analysis tag', module.release))
              }
              return new Spacebars.SafeString(list.join('<span class="inner-r-10"></span>'));
            }
            return '';
          }
        },
        {
          fieldId: 'components',
          key: 'components',
          label: 'Components',
          fn: function (value, object) {
            return object.getStatistics && object.getStatistics(approve.getModuleAnalysis(object._id)).components ?
              object.getStatistics(approve.getModuleAnalysis(object._id)).components : '';
          }
        },
        {
          fieldId: 'legal',
          key: 'legal',
          label: 'Legal',
          tmpl: Template.reactiveTableLegalStats,
          sortable: false,
          cellClass: 'col-180'
        },
        {
          fieldId: 'vulnerabilities',
          key: 'vulnerabilities',
          label: 'Security',
          tmpl: Template.reactiveTableVulnerabilityStats,
          sortable: false,
          cellClass: 'col-180'
        },
        {
          fieldId: 'quality',
          key: 'quality',
          label: 'Quality',
          tmpl: Template.reactiveTableQualityStats,
          sortable: false,
          cellClass: 'col-180'
        }
      ]
    };
  }
});
