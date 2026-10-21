import SPDXExports from '/imports/lib/collections/SPDXExports';

const find = function ({moduleId}) {
  if(moduleId){
    return SPDXExports.find({moduleId}).fetch();
  }else {
    return []
  }
};

export default find;
