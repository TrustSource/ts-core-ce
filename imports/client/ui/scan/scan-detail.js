import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import Sticky from 'sticky-js';
import Modules from '/imports/lib/collections/modules';

Template.scanDetail.onCreated(function () {
  Session.set('isGraphView')
  const self = this;
  self.autorun(function () {
    const scan = Template.currentData();
    if (scan && scan.moduleId) {
      self.subscribe('moduleById', scan.moduleId);
    }
  });
});

Template.scanDetail.events({
  'click .scan-reprocess': function () {
    const scan = Template.currentData();
    Meteor.callAsync('reprocessScan', scan._id);
    Notify.success('Scan processing and analysis started');
  }
});

Template.scanDetail.helpers({
  scan: function () {
    return Template.currentData()
  },
  // Header shows a count only - a full link (e.g. an image digest) is too long
  // for the title line; the Binary links modal lists them
  binaryLinksLabel: function () {
    const count = (Template.currentData().binaryLinks || []).length;
    return count + (count === 1 ? ' binary link' : ' binary links');
  },
  binaryLinksTitle: function () {
    return _.pluck(Template.currentData().binaryLinks || [], 'name').join('\n');
  }
});

Template.scanContent.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  const scan = Template.currentData().data;
  Session.set('selectedScanDependency', scan && scan.dependencies && scan.dependencies[0]);
  Session.set('selectedTreeLevel', 'collapsed');

  // walk over all nodes and count their siblings recursively
  // store the siblings count for each node in node.tags[0]
  const countNodes = function countNodes(node) {
    if (node && node.tags && node.tags.length === 0) {
      let count = 0;
      if (node.nodes) {
        count = _.reduce(node.nodes, function (prev, elem) {
          let total = countNodes(elem);
          return prev + (Number.isInteger(total) ? total : 1);
        }, 0);
      }
      node.tags.push(count);
    }
    return (node && node.tags && node.tags[0]) + 1;
  };

  const cvrtTree = function (deps, moduleName) {
    const scan = Template.currentData().data;
    const hideLinked = Session.get('hideLinkedModules')
    const moduleDoc = scan && scan.moduleId && Modules.findOne(scan.moduleId);
    const linkedReleases = moduleDoc && moduleDoc.linkedReleases;
    const linkedModules = moduleDoc && moduleDoc.linkedModules;
    const rootNodes = _.map(deps, function (dep) {
      const node = {
        text: dep.name + ' - ' + dep.key,
        tags: [],
        data: dep,
        scanLink: dep.scanLink || null
      };
      if (dep.dependencies && dep.dependencies.length > 0) {
        node.nodes = cvrtTree(dep.dependencies, moduleName);
      }
      if (dep.private) {
        node.icon = 'fa fa-lock';
      }
      if (dep.meta && dep.meta.lifecycleScripts) {
        node.icon = 'fa fa-file-code';
      }
      if(node.scanLink && moduleName[moduleName.length-1] != node.scanLink){
        node.tags = ['More details in _part-'+node.scanLink]
      }
      if(linkedReleases && linkedReleases.length){
        const matched = linkedReleases.find((item)=>{
          return item.key === dep.key
        })
        if(matched){
          node.icon = 'fa fa-copy inner-r-10i';
        }
        node.hasLinks = matched ? matched : false
      }
      if(linkedModules && linkedModules.length){
        const matchedModule = linkedModules.find((item)=>{
          return item.key === dep.key
        })
        if(matchedModule){
          node.icon = 'fa fa-link inner-r-10i';
        }
        node.hasModuleLink = matchedModule ? matchedModule : false
      }
      if(!hideLinked || (hideLinked && !node.hasLinks)){
        return node;
      }
      return null;
    }).filter((node)=>{
      return !!node
    });
    // fill tags with siblings count for each root node
    rootNodes.forEach(countNodes);
    return rootNodes;
  };

  this.autorun(function () {
    if (scan && scan.dependencies) {
      $('#tree').treeview({
        data: cvrtTree(scan.dependencies, scan.module),
        nodeIcon: 'fa',
        expandIcon: 'fa fa-list fa-plus',
        collapseIcon: 'fa fa-list fa-minus',
        levels: Session.get('selectedTreeLevel') === 'expanded' ? 1000 : 2,
        showTags: true,
        enableLinks: false,
        onNodeSelected: function (event, node) {
          Session.set('selectedScanDependency', node.data);
        }
      });
      new Sticky('.scanDetailSideInfo');
    }
  });
});

Template.scanContent.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
  const treeView = $('#tree').treeview(true);
  treeView && treeView.remove() ;
  Session.set('selectedScanDependency');
  Session.set('selectedTreeLevel');
});

Template.scanContent.helpers({
  component: function () {
    return Session.get('selectedScanDependency');
  },
  collapseButtonClasses: function (classes) {
    return Session.get('selectedTreeLevel') === 'expanded' ? classes + ' btn-primary' : classes + ' btn-default';
  },
  expandButtonClasses: function (classes) {
    return Session.get('selectedTreeLevel') === 'collapsed' ? classes + ' btn-primary' : classes + ' btn-default';
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  dendrogramData: function () {
    const data = Template.currentData().data.dependencies;
    let plainTree = [{
      name: 'root'
    }];
    buildPlainTree(plainTree, data)
    return plainTree
  },
  isGraphView: function () {
    let view = Session.get('isGraphView')
    if(!view && $('#tree').empty()){
      Session.set('hideLinkedModules', true)
      Meteor.setTimeout(()=>{
        Session.set('hideLinkedModules', false)
      },100)
    }
    return view
  }
});

function buildPlainTree(plainTree, data, parent){
  if(Array.isArray(data)){
    data.forEach((item)=>{
      buildPlainTree(plainTree, item, parent)
    })
  }
  if(data.name){
    if(parent){
      data.parent = plainTree.findIndex((item)=>{
        return item.key === parent.key
      })
    }else{
      data.parent = 0
    }
    plainTree.push(data)
    if(data.dependencies && data.dependencies.length){
      buildPlainTree(plainTree, data.dependencies, data)
    }
  }
}

Template.scanContent.events({
  'click .actions a': function (event) {
    event.preventDefault();
    let target = $(event.target).closest('a');
    if (target.hasClass('collapse-all')) {
      Session.set('selectedTreeLevel', 'collapsed');
    } else {
      Session.set('selectedTreeLevel', 'expanded');
    }
    target.closest('.actions').find('.btn').toggleClass('hidden');
  },
  'click .actions-linked a': function (event) {
    event.preventDefault();
    let target = $(event.target).closest('a');
    if (target.hasClass('hide-linked')) {
      Session.set('hideLinkedModules', true);
    } else {
      Session.set('hideLinkedModules', false);
    }
    target.closest('.actions-linked').find('.btn').toggleClass('hidden');
  },
  'click .change-presentation-table': function (event) {
    event.preventDefault();
    Session.set('isGraphView', false);
  },
  'click .change-presentation-graph': function (event) {
    event.preventDefault();
    Session.set('isGraphView', true);
  }
});

Template.scanDetailSideInfo.helpers({
  getScanModuleId: function () {
    const scan = Template.parentData();
    return scan && scan.data && scan.data.moduleId;
  },
  isSingleRootComponentScan: function () {
    if (this.parentPath && this.parentPath !== '/') return false;
    const scan = Template.parentData();
    const scanData = scan && scan.data;
    if (!scanData || !scanData.moduleId) return false;
    const candidates = (scanData.dependencies || []).filter(function (dep) {
      return dep && dep.dependencies && dep.dependencies.length > 0;
    });
    if (candidates.length !== 1) return false;
    return !!(this.key && this.key === candidates[0].key);
  },
  scanRootModuleId: function () {
    const scan = Template.parentData();
    return scan && scan.data && scan.data.moduleId;
  },
  scanRootKey: function () {
    return this.key;
  },
  getLakeOptions: function () {
    if(this.component && this.component._id){
      return {_id: this.component._id};
    }
    return {key: this.key};
  },
  getScanLinkedReleases: function () {
    const scan = Template.parentData();
    const moduleId = scan && scan.data && scan.data.moduleId;
    const moduleDoc = moduleId && Modules.findOne(moduleId);
    return moduleDoc && moduleDoc.linkedReleases;
  },
  getScanLinkedModules: function () {
    const scan = Template.parentData();
    const moduleId = scan && scan.data && scan.data.moduleId;
    const moduleDoc = moduleId && Modules.findOne(moduleId);
    return moduleDoc && moduleDoc.linkedModules;
  },
  getModuleLinkForComponent: function () {
    const scan = Template.parentData();
    const moduleId = scan && scan.data && scan.data.moduleId;
    const moduleDoc = moduleId && Modules.findOne(moduleId);
    const linkedModules = moduleDoc && moduleDoc.linkedModules;
    const component = this;
    if (linkedModules && component) {
      const found = linkedModules.find(function (item) {
        return item.key === component.key;
      });
      if (found) {
        return Object.assign({}, found, {moduleId: moduleId});
      }
    }
    return null;
  },
  getBreadcrumbs: function () {
    return this.parentPath && this.parentPath.split('/').map((item)=>{
      return decodeURIComponent(item)
    });
  },
  isDenied: function () {
    const company = Session.get('company');
    let self = this
    if(company && company.blacklistedAlgorithms && company.blacklistedAlgorithms.length){
      return company.blacklistedAlgorithms.some(algorithm => {
        if(!algorithm.key || !self.algorithm){
          return false;
        }
        return algorithm.key.toLowerCase() === self.algorithm.toLowerCase();
      })
    }else{
      return false
    }
  }
});


