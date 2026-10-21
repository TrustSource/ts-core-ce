import _ from 'underscore';
import {NoticeFileSchema} from '/imports/lib/schemas/noticeFileSchema';
import Modules from '/imports/lib/collections/modules'
import Projects from '/imports/lib/collections/projects';
import {Session} from 'meteor/session';

const NoticeFile = function (doc) {
  _.extend(this, doc);

  this.project = function () {
    return this.projectId && Projects.findOne(this.projectId);
  };

  this.module = function () {
    let projectId = this.projectId
    let moduleId = this.moduleId
    let module = moduleId && Modules.findOne(this.moduleId)
    if(module){
      return module
    }
    let modules = Session.get('modulesByProject');
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
};

NoticeFile.prototype.validate = function () {
  const context = NoticeFileSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

NoticeFile.prototype.getName = function () {
  return this.moduleId ? this.module() && this.module().name || 'Module is N.A.'
    : this.project() && this.project().name || 'Project is N.A.';
};

NoticeFile.prototype.getDescription = function () {
  return this.description ? this.description : 'Notice file details';
};

export default NoticeFile;
