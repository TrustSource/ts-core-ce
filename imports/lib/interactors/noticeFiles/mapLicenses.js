import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import LicensesService from '/imports/api/licenses';
import Components from '/imports/lib/collections/components';
import Modules from '/imports/lib/collections/modules'
import ComponentModifications from '/imports/lib/collections/componentModifications';
import Utils from '/imports/lib/utils';
import InfrastructureComponents from '../../collections/infrastructureComponents';

async function isUnchanged(moduleObj, moduleIds, componentKey, version, path) {
  if(moduleIds && moduleIds.length){
    for (const moduleId of moduleIds) {
      let module = await Modules.findOneAsync(moduleId);
      if (!(module && module.isComponentUnchanged && module.isComponentUnchanged(componentKey, version, path))) {
        return false;
      }
    }
    return true;
  }else if(moduleObj){
    return moduleObj.isComponentUnchanged && moduleObj.isComponentUnchanged(componentKey, version, path)
  }
  return false
}
function processStatus(statusParam) {
  let list = _.flatten(_.filter(statusParam,function (item) {
    return !!item && item !== ''
  }));
  return list.length > 0 ? _.unique(_.flatten(list.join('; ').split('; '))) : [];
}

function actionsToObligations(key, obligations) {
  if(key.indexOf(',') > -1){
    return _.some(obligations, function (obligation) {
      return key.split(',').indexOf(obligation) > -1
    })
  }else {
    return obligations.indexOf(key) > -1
  }
}

// First revision from 2019.02.07 at 18:13 and updated 2019.04.05 at 16:28
// O00 RetainCopyRightNotice
//   => no further action!
// O01 ProvideCopyOfLicenseText
//   => Show license text
// (it might happen that we will have components where it is not required to show the license text, but we will always provide
//   the license text! license appears?=>display license and component underneath)
// O02 TechnicalRestriction (no action)
//   => no further action!
// O10 ReproduceCopyrightNotice
//   => Show Copyright notice for component and display source (source: {GitHub/mavencentral/Company})
//   if not available,
//     => show copyright from license and set source (source: {license})
//     if not available
//       => provide  empty copyright field (source: COMPANYNAME)
//       else show "not required" and "provide anyway" switch, treat as above
//   INFO: The license requires to mention the copyright holder. If we know the copyright holder, it will be mentioned here.
//    If not, it is most likely that our data discovery was not able to identify it. You may want to jump to the component
//    and use a repo link to investigate manually.
// O11 ReproduceWarrantyDisclaimer
//   => done by show ing the license text. So no further action required.
// O20 ReproduceListOfConditions
//   => done by showing the license text. So no further action required
// O21 ReproduceCopyrightNotice
//   => Show Copyright notice for component and display source (source: {GitHub/mavencentral/Company})
// O22 RetainWarrantyDisclaimer
//   => no further action!
// O23 ProvideSourceCode
//   => Provide textinput to enter a URL (might be prefilled with repo URL)
//   INFO: This license requires you to provide the source code of your solution. Here you may put a link,
//    that points to a repository. If you prefer to provide a more reliable download location, feel free to enter an alternative.
// O40 Copyleft
//   => no further action!
// O41 ProvideSourcesOfModifiedSW
//   => Provide textinput to enter a URL (might be prefilled with repo URL)
//   INFO: This license requires you to make the modified sources avaible. You may specify a download location here.
//    It might be  branch or fork of the original component. However, if you plan for a more reliable location,
//    we might encourage you to think about Software heritage. If you think the component was not modified, it may be worth
//    changing the component modified status in the corresponding module.
// O42 ShowChanges
//   => Provide textinput to enter a URL
//   INFO: The license requires you to indicate the changes you have made. There is no documentation standard yet,
//     but a link to a webpage oder PDF containing the changes in form of a list, should be considered as sufficient.
//     If you think the component was not modified, it may be worth changing the component modified status in the corresponding module.
// O60 ProvideSourceCode
//   => Provide textinput to enter a URL (might be prefilled with repo URL)
//   INFO: This license requires you to provide the source code of your solution. Here you may put a link,
//    that points to a repository. If you prefer to provide a more reliable download location, feel free to enter an alternative.

function isObligationCompleted (keys, obligations, resolved){
  let listObligations = keys.split(',')
  return _.every(obligations, function (obligation) {
    if(listObligations.indexOf(obligation) === -1){
      return true
    }
    return resolved.indexOf(obligation) > -1
  })
}

const NF_CREATED_BY = 'Notice file created By '

function calculateActions(status, component, module) {
  const array = module && module.obligationConfig || [];
  const key = component.componentKey;
  const resolved = _.map(_.filter(array, function (entry) {
    return key && entry.key ? entry.key === key : true
  }),function (item){
    return item.obligationKey
  });
  let actions = [];
  const keysToAutoresolve = 'O11,O22'
  if(actionsToObligations(keysToAutoresolve, status.obligations)){
    actions.push({
      key: 'ReproduceWarrantyDisclaimer',
      completed: true
    });
    if(!isObligationCompleted(keysToAutoresolve, status.obligations, resolved)){
      keysToAutoresolve.split(',').forEach(function (item){
        if(status.obligations.indexOf(item) > -1){
          const now = new Date();
          const comment = NF_CREATED_BY + Utils.username() + ', ' + now.toLocaleDateString('en-uk');
          if(module.newObligationConfig){
            module.newObligationConfig.push({key: key, obligationKey: item, comment: comment});
          }else{
            module.newObligationConfig = [{key: key, obligationKey: item, comment: comment}]
          }
        }
      })
    }
  }
  const keysToAutoresolve2 = 'O01'
  if(actionsToObligations(keysToAutoresolve2, status.obligations)){
    actions.push({
      key: 'ProvideCopyOfLicenseText',
      completed: true
    });
    if(!isObligationCompleted(keysToAutoresolve2, status.obligations, resolved)){
      keysToAutoresolve2.split(',').forEach(function (item){
        if(status.obligations.indexOf(item) > -1){
          const now = new Date();
          const comment = NF_CREATED_BY + Utils.username() + ', ' + now.toLocaleDateString('en-uk');
          if(module.newObligationConfig){
            module.newObligationConfig.push({key: key, obligationKey: item, comment: comment});
          }else{
            module.newObligationConfig = [{key: key, obligationKey: item, comment: comment}]
          }
        }
      })
    }
  }
  const keysToAutoresolve3 = 'DIST_1,DIST_2'
  if(actionsToObligations(keysToAutoresolve3, status.violations)){
    actions.push({
      key: 'DistributionRestriction',
      completed: true
    });
    if(!isObligationCompleted(keysToAutoresolve3, status.violations, resolved)){
      keysToAutoresolve3.split(',').forEach(function (item){
        if(status.violations.indexOf(item) > -1){
          const now = new Date();
          const comment = NF_CREATED_BY + Utils.username() + ', ' + now.toLocaleDateString('en-uk');
          if(module.newRulesConfig){
            module.newRulesConfig.push({key: key, ruleKey: item, comment: comment});
          }else{
            module.newRulesConfig = [{key: key, ruleKey: item, comment: comment}]
          }
        }
      })
    }
  }
  if(actionsToObligations('O10,O21', status.obligations)){
    actions.push({
      key: 'Copyright',
      completed: isObligationCompleted('O10,O21', status.obligations, resolved)
    });
  }
  if(actionsToObligations('O23,O60', status.obligations)){
    actions.push({
      key: 'Sources',
      completed: isObligationCompleted('O23,O60', status.obligations, resolved)
    });
  }
  if(actionsToObligations('O41', status.obligations)){
    actions.push({
      key: 'ModifiedSources',
      completed: isObligationCompleted('O41', status.obligations, resolved)
    });
  }
  if(actionsToObligations('O42', status.obligations)){
    let completed = isObligationCompleted('O42', status.obligations, resolved)
    actions.push({
      key: 'Modifications',
      completed: !!completed
    });
    actions.push({
      key: 'ModificationsText',
      completed: !!completed
    });
  }
  return actions
}

function writtenOfferRequired(status) {
  return actionsToObligations('O23', status.obligations)
}

async function findOneComponentModifications(type, extComponent, moduleObj, moduleIds, companyId) {
  if(moduleIds && moduleIds.length){
    return await ComponentModifications.findOneAsync({
      'component.key': extComponent.key,
      'component.version': extComponent.version,
      'moduleId': {$in: moduleIds},
      'companyId': companyId,
      'type': type
    }, {sort: {created: -1}, limit: 1});
  }else if(moduleObj){
    return await ComponentModifications.findOneAsync({
      'component.key': extComponent.key,
      'component.version': extComponent.version,
      'moduleId': moduleObj._id,
      'companyId': companyId,
      'type': type
    }, {sort: {created: -1}, limit: 1});
  }
}

// eslint-disable-next-line sonarjs/cognitive-complexity
const mapLicenses = async function (licenses, module, companyId) {
  let processDataUnsorted = [];
  for (const license of licenses) {
    if(license){
      let licenseKey = license.key;
      if (licenseKey && typeof licenseKey !== 'string') {
        licenseKey = licenseKey.name || licenseKey.key || JSON.stringify(licenseKey);
      }
      let licenseName = license.name;
      if (licenseName && typeof licenseName !== 'string') {
        licenseName = licenseName.name || licenseName.key || JSON.stringify(licenseName);
      }
      const foundLicense = LicensesService.find(licenseKey);
      let extLicense = {
        key: licenseKey || 'unknown',
        name: licenseName || licenseKey || 'unknown',
        moduleIds: license.moduleIds,
        completed: false
      };
      if(foundLicense){
        extLicense.text = foundLicense.text;
        extLicense.url = foundLicense.url;
        extLicense.copyright = foundLicense.copyright;
      }
      license.components = _.map(Object.values(_.groupBy(license.components,function (component) {
        return component.componentKey
      })),function (components) {
        let status = {
          'deadlyObligations': [],
          'obligations': [],
          'violations': []
        };
        let paths = _.uniq(_.filter(_.map(components, function (component) {
          if(component.status && component.status.deadlyObligations){
            status.deadlyObligations.push(component.status.deadlyObligations);
          }
          if(component.status && component.status.obligations){
            status.obligations.push(component.status.obligations);
          }
          if(component.status && component.status.violations){
            status.violations.push(component.status.violations);
          }
          return component.path
        }), function (path) { return !!path; }));
        let newComponent = components[0];
        delete newComponent.path;
        newComponent.paths = paths;
        status = {
          'deadlyObligations': processStatus(status.deadlyObligations),
          'obligations': processStatus(status.obligations),
          'violations': processStatus(status.violations)
        };
        newComponent.actionsRequired = calculateActions(status, newComponent, module);
        newComponent.writtenOffer = writtenOfferRequired(status);
        newComponent.status = status;
        return newComponent
      });
      extLicense.obligations = 0;
      let anyAction = 0;
      let extComponents = [];
      for (const component of license.components) {
        let foundComponent;
        if(component.componentKey.indexOf('im:') === 0){
          foundComponent = await InfrastructureComponents.findOneAsync({key: component.componentKey},{fields: {logs: 0, crawlerInfo: 0}})
        }else{
          foundComponent = await Components.findOneAsync(
            {$or:[{key: component.componentKey}, {oldKey: component.componentKey}]},{fields: {logs: 0, crawlerInfo: 0}})
        }
        // Was inverted: it yielded null whenever paths existed and indexed an absent
        // array when they did not, so the unchanged lookup never saw a real path.
        let path = (component.paths && component.paths.length > 0) ? component.paths[0] : null;
        const unchanged = !!(await isUnchanged(module, extLicense.moduleIds, component.componentKey, component.version, path));
        let extComponent = {
          key: component.componentKey,
          version: component.version,
          paths: component.paths,
          actionsRequired: component.actionsRequired,
          unchanged: unchanged,
          unchangedInitValue: unchanged,
          changesUrl: '',
          changedSourcesUrl: '',
          changesText: '',
          sourcesUrl: '',
          writtenOffer: component.writtenOffer,
          moduleIds: extLicense.moduleIds
        };
        if(foundComponent){
          const versionData = foundComponent.getVersion(component.version);
          extComponent.name = foundComponent.getName();
          extComponent.description = foundComponent.data().description;
          extComponent.copyright = versionData && versionData.data().copyright || extLicense.copyright ||
            foundComponent.getDeclaredCopyright();
          extComponent.urls = foundComponent.data().urls;
        }
        for (let index = 0; index < extComponent.actionsRequired.length; index++) {
          const action = extComponent.actionsRequired[index];
          if(action.completed === false){
            if(action.key === 'Copyright'){
              let type = 'copyright';
              let lastChange = await findOneComponentModifications(type, extComponent, module, extLicense.moduleIds, companyId);
              if(lastChange){
                extComponent[type] = lastChange.value;
              }
              if(extComponent[type]){
                extComponent.actionsRequired[index].completed = true;
              }
            } else if(action.key === 'Sources'){
              let type = 'sourcesUrl';
              let lastChange = await findOneComponentModifications(type, extComponent, module, extLicense.moduleIds, companyId);
              if(lastChange){
                extComponent[type] = lastChange.value;
                extComponent.actionsRequired[index].completed = true;
              }
            } else if(action.key === 'ModifiedSources'){
              let type = 'changedSourcesUrl';
              let lastChange = await findOneComponentModifications(type, extComponent, module, extLicense.moduleIds, companyId);
              if(lastChange){
                extComponent[type] = lastChange.value;
                extComponent.actionsRequired[index].completed = true;
              }
            } else if(action.key === 'ModificationsText'){
              let type = 'changesText';
              let lastChangeUrl = await findOneComponentModifications('changesUrl', extComponent, module, extLicense.moduleIds, companyId);
              if(!lastChangeUrl) {
                let lastChange = await findOneComponentModifications(type, extComponent, module, extLicense.moduleIds, companyId);
                if (lastChange) {
                  extComponent[type] = lastChange.value;
                  extComponent.actionsRequired[index].completed = true;
                }
              }else{
                extComponent.actionsRequired[index].completed = true;
              }
            } else if(action.key === 'Modifications'){
              let type = 'changesUrl';
              let lastChangeText = await findOneComponentModifications(
                'changesText', extComponent, module, extLicense.moduleIds, companyId);
              if(!lastChangeText){
                let lastChange = await findOneComponentModifications(type, extComponent, module, extLicense.moduleIds, companyId);
                if(lastChange){
                  extComponent[type] = lastChange.value;
                  extComponent.actionsRequired[index].completed = true;
                }
              }else{
                extComponent.actionsRequired[index].completed = true;
              }
            }
          }
        }
        const actionsLeftToDo = extComponent.actionsRequired.filter(function (action) {
          return !action.completed
        });
        extComponent.completed = actionsLeftToDo.length === 0;
        anyAction = anyAction + actionsLeftToDo.length;
        extLicense.obligations = extLicense.obligations + component.status.obligations.length;
        extComponents.push(extComponent);
      }
      extLicense.components = _.sortBy(extComponents, function (component) {
        return component && (component.name && component.name.toLowerCase() ||  component.key && component.key.toLowerCase())
      });
      if(anyAction === 0){
        extLicense.completed = true
      }
      if(_.some(extLicense.components, function (component) {
        return component.writtenOffer
      })){
        extLicense.writtenOffer = true;
      }
      processDataUnsorted.push(extLicense);
    } else {
      processDataUnsorted.push(license);
    }
  }
  let processData = _.sortBy(processDataUnsorted, function (license) {
    return String(license.name || license.key || '').toLowerCase()
  });
  // Persist freshly-defaulted obligation/rule configs only for a real module. For
  // project-level notices `module` is an empty placeholder ({}), so there is no single
  // module to write to - skip (the per-module notice run persists these). Guarding on
  // module._id also avoids the updateCollection 'Invalid id' guard throwing on undefined.
  if(module._id && module.newObligationConfig){
    const arr = module.obligationConfig || [];
    const originalData = _.clone(arr);
    module.newObligationConfig.forEach( function (item) {
      return arr.push(item)
    })
    await Meteor.callAsync('updateCollection', 'Modules', module._id, 'obligationConfig', arr, true, originalData);
    await Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
  }
  if(module._id && module.newRulesConfig){
    const arr = module.legalRulesConfig || [];
    const originalData = _.clone(arr);
    module.newRulesConfig.forEach( function (item) {
      return arr.push(item)
    })
    await Meteor.callAsync('updateCollection', 'Modules', module._id, 'legalRulesConfig', arr, true, originalData);
    await Modules.updateAsync(module._id, {$set: {analysisRequired: true}});
  }
  return processData
};

export default mapLicenses;
