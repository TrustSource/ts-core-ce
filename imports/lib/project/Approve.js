import _ from 'underscore';
import Utils from '/imports/lib/utils';
import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules'
import Projects from '/imports/lib/collections/projects';

const Approve = function (companyId, projectId, data) {

  if(data){
    _.extend(this, data);
  }
  if (!projectId) {
    _.extend(this, companyId);
  } else {
    this.companyId = companyId;
    this.projectId = projectId;
  }

  this.project = function () {
    if (Meteor.isServer) return null; // Use projectAsync() on server
    return this.projectId && Projects.findOne(this.projectId);
  };

  this.projectAsync = async function () {
    return this.projectId && await Projects.findOneAsync(this.projectId);
  };

  this.projectMeta = function () {
    if (Meteor.isServer) return null; // Use projectMetaAsync() on server
    return this.projectId && Projects.findOne(this.projectId, {fields: {name: 1, description: 1}});
  };

  this.projectMetaAsync = async function () {
    return this.projectId && await Projects.findOneAsync(this.projectId, {fields: {name: 1, description: 1}});
  };

  this.module = function () {
    if (Meteor.isServer) return null; // Use moduleAsync() on server
    return this.moduleId && Modules.findOne(this.moduleId);
  };

  this.moduleAsync = async function () {
    return this.moduleId && await Modules.findOneAsync(this.moduleId);
  };

  this.moduleMeta = function () {
    if (Meteor.isServer) return null; // Use moduleMetaAsync() on server
    return this.moduleId && Modules.findOne(this.moduleId, {fields: {name: 1, description: 1}});
  };

  this.moduleMetaAsync = async function () {
    return this.moduleId && await Modules.findOneAsync(this.moduleId, {fields: {name: 1, description: 1}});
  };
};

export default Approve;

Approve.prototype.reset = function (projectId, moduleId, draft) {
  const user = Meteor.user();
  this.name = '';
  this.version = '';
  this.description = '';
  this.purl = '';
  this.projectId = projectId;
  this.moduleId = moduleId;
  this.companyId = user.profile.companyId;
  this.userId = user._id;
  this.userName = Utils.username();
  this.modules = [];
  this.draft = !!draft;
};

Approve.prototype.setName = function (name) {
  this.name = name
};

Approve.prototype.getName = function () {
  return this.name
};

Approve.prototype.setDescription = function (description) {
  this.description = description
};

Approve.prototype.getDescription = function () {
  return this.description
};

Approve.prototype.setDraft = function (draft) {
  this.draft = draft
};

Approve.prototype.getDraft = function () {
  return this.draft
};

Approve.prototype.setVersion = function (version) {
  this.version = version
};

Approve.prototype.getVersion = function () {
  return this.version
};

Approve.prototype.setPurl = function (purl) {
  this.purl = purl
};

Approve.prototype.getPurl = function () {
  return this.purl
};

Approve.prototype.isSelectedModule = function (moduleId) {
  return _.any(this.modules,function (module) {
    return module._id === moduleId
  })
};

Approve.prototype.toggleModule = function (moduleId) {
  if(_.any(this.modules,function (module) {
    return module._id === moduleId
  })) {
    this.modules = _.reject(this.modules,function (module) {
      return module._id === moduleId
    })
  }else{
    this.modules.push({
      _id: moduleId
    })
  }
};

Approve.prototype.selectModule = function (moduleId, version) {
  if(!_.any(this.modules,function (module) {
    return module._id === moduleId
  })) {
    this.modules.push({
      _id: moduleId,
      version: version
    })
  }
};

Approve.prototype.noSelectedModules = function () {
  return this.modules.length === 0
};

Approve.prototype.setModuleAnalysis = function (moduleId, analysis) {
  let module = _.find(this.modules,function (module) {
    return module._id === moduleId
  });
  let {_id, date, tag, branch, scanId, release, binaryLinks} = analysis;
  module.date = date || null;
  module.scanId = scanId || null;
  module.analysisId = _id;
  module.branch = branch || null;
  module.tag = tag || null;
  module.release = release || null;
  module.binaryLinks = binaryLinks || null;
};

Approve.prototype.getModuleIds = function () {
  return _.map(this.modules,function (module) {
    return module._id
  });
};

Approve.prototype.getModules = function () {
  return this.modules;
};

Approve.prototype.getModuleAnalysis = function (moduleId) {
  let module = _.find(this.modules,function (module) {
    return module._id === moduleId
  });
  if(module){
    return module.analysisId;
  }
  return false
};

Approve.prototype.getModule = function (moduleId) {
  let module = _.find(this.modules,function (module) {
    return module._id === moduleId
  });
  if(module){
    return module;
  }
  return false
};

Approve.prototype.getData = function () {
  return {
    name: this.name,
    version: this.version,
    description: this.description,
    projectId: this.projectId,
    moduleId: this.moduleId,
    modules: this.modules,
    draft: this.draft,
    purl: this.purl
  }
};

Approve.prototype.getPublicData = function () {
  return {
    _id: this._id,
    approved: this.approved,
    closedByName: this.closedByName,
    name: this.name,
    version: this.version,
    description: this.description,
    projectId: this.projectId,
    moduleId: this.moduleId,
    modules: this.modules,
    purl: this.purl,
    projectObj: this.projectMeta(),
    moduleObj: this.moduleMeta()
  }
};

Approve.prototype.getPublicDataAsync = async function () {
  return {
    _id: this._id,
    approved: this.approved,
    closedByName: this.closedByName,
    name: this.name,
    version: this.version,
    description: this.description,
    projectId: this.projectId,
    moduleId: this.moduleId,
    modules: this.modules,
    purl: this.purl,
    projectObj: await this.projectMetaAsync(),
    moduleObj: await this.moduleMetaAsync()
  }
};

Approve.prototype.getStats = function (type) {
  return (this.stats && this.stats[type]) || {}
};
