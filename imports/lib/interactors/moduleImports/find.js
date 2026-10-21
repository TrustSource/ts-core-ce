import ModuleImports from '/imports/lib/collections/moduleImports';

const find = function ({projectId}) {
  if(projectId){
    return ModuleImports.find({'meta.projectId': projectId}).fetch();
  }else {
    return []
  }
};

export default find;
