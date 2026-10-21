import SPDXImports from '/imports/lib/collections/SPDXImports';

const find = function ({projectId}) {
  if(projectId){
    return SPDXImports.find({projectId}).fetch();
  }else {
    return []
  }
};

export default find;
