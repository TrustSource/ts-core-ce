import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import {SbomFileSchema} from '/imports/lib/schemas/sbomFileSchema';
import Modules from '/imports/lib/collections/modules'
import Projects from '/imports/lib/collections/projects';
import Companies from '/imports/lib/collections/companies';
import {Session} from 'meteor/session';

const SbomFile = function (doc) {
  _.extend(this, doc);

  this.project = function () {
    return this.projectId && Projects.findOne(this.projectId);
  };

  this.projectAsync = async function () {
    return this.projectId && await Projects.findOneAsync(this.projectId);
  };

  this.company = function () {
    return Session ? Session.get('company') || Companies.findOne(this.companyId).data() : null;
  };

  this.module = function () {
    let projectId = this.projectId
    let moduleId = this.moduleId
    let module = moduleId && Modules.findOne(this.moduleId)
    if(module){
      return module
    }
    let modules = Session ? Session.get('modulesByProject') || Meteor.call('modulesByProject') : null;
    if(modules){
      let listModules = _.filter(_.filter(modules, (module)=>{
        return projectId === Projects.UNASSIGNED ? !module.projectId : module.projectId === projectId
      }), (module)=>{
        return moduleId === module._id
      })
      return listModules[0];
    }
    return null
  };

  this.moduleAsync = async function () {
    let moduleId = this.moduleId;
    return moduleId && await Modules.findOneAsync(moduleId);
  };
};

SbomFile.prototype.validate = function () {
  const context = SbomFileSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

SbomFile.prototype.getName = function () {
  return this.moduleId ? this.module() && this.module().name || 'Module is N.A.'
    : this.project() && this.project().name || 'Project is N.A.';
};

SbomFile.prototype.getDescription = function () {
  return this.description ? this.description : 'Software bill of materials file details';
};

export default SbomFile;
