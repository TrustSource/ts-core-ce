import Components from '/imports/lib/collections/components';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import Scans from '/imports/lib/collections/scans';
import _ from 'underscore';

const getComponent = async function (module, projComp) {
  let component;
  if(projComp.key.indexOf('im:') === 0){
    component = await InfrastructureComponents.findOneAsync({key: projComp.key}, {fields: {logs: 0, crawlerInfo: 0, cpe: 0}});
  }else{
    component = await Components.findOneAsync(
      {$or:[{key: projComp.key}, {oldKey: projComp.key}]}, {fields: {logs: 0, crawlerInfo: 0, cpe: 0}});
  }
  if (component) {
    // extend with component data ( filter versions )
    const data = component.data();
    // filter versions not used in module, for found versions, check if vulnerability was found
    if (data.versions) {
      data.versions = _.filter(data.versions, function (v) {
        return projComp.versions.indexOf(v.version) >= 0;
      });
    }
    // AWAITED. These methods exist only on the server (they are declared inside
    // `if (Meteor.isServer)`) and read the CVE lake through an async cursor, so a
    // bare call returns `data` before a single finding has been written to it.
    await component.findVulnerabilities(module.companyId);

    // for each used component copy path information
    projComp.versions.filter(version => version).forEach(function (v) {
      const version = component.findVersion(v.version);
      if (version) {
        version.data().paths = v.paths;
      }
    });
    const dependencies = [];
    for (const projCompChild of ((projComp && projComp.dependencies) || [])) {
      const dep = await getComponent(module, projCompChild);
      if (dep) {
        dependencies.push(dep);
      }
    }
    data.dependencies = dependencies;

    return data;
  } else {
    console.log('modules.getComponent(%s) for module: %s, component not found: %s',
      module._id, module.name, projComp.key);
  }
};

const getComponents = async function (module) {
  const startTime = new Date();
  // getScanId() relies on getAnalysis() which returns null on the server, so use
  // the async variant here (this interactor runs server-side, e.g. for export).
  let scanId = typeof module.getScanIdAsync === 'function'
    ? await module.getScanIdAsync()
    : module.getScanId();
  let scan = await Scans.findOneAsync(scanId);

  const components = [];
  for (const projComp of ((scan && scan.dependencies) || [])) {
    const comp = await getComponent(module, projComp);
    if (comp) {
      components.push(comp);
    }
  }

  console.log('modules.getComponents(%s) for module: %s, took %s millis',
    module._id, module.name, new Date() - startTime);

  return components;
};

export default getComponents;
