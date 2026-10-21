/* global process:false */
/* eslint no-control-regex: "off" */

import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import {Roles} from 'meteor/alanning:roles';
import Utils from '/imports/lib/utils';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import Components from '/imports/lib/collections/components';
import RestApi from '/imports/server/rest-api/RestApi';

/* temporary workaround until meteor/node supports ES6*/
if (!String.prototype.endsWith) {
  console.log('=========> String.prototype.endsWith missing: applying shim');
  String.prototype.endsWith = function (searchString, position) {
    const subjectString = this.toString();
    if (position === undefined || position > subjectString.length) {
      position = subjectString.length;
    }
    position -= searchString.length;
    const lastIndex = subjectString.indexOf(searchString, position);
    return lastIndex !== -1 && lastIndex === position;
  };
}
if (!String.prototype.startsWith) {
  console.log('=========> String.prototype.startsWith missing: applying shim');
  String.prototype.startsWith = function (searchString, position) {
    position = position || 0;
    return this.indexOf(searchString, position) === position;
  };
}

 
export default (function (Utils) {

  if (!Utils) {
    throw Error('Unable to extend global Utils Object for server site!');
  }

  Utils.removeVT100Esc = function removeVT100Esc(line) {
    return line.replace(/\x1B\[\d{1,2}[m|K]/g, '');
  };

  Utils.stringAsUnicodeEsc = function stringAsUnicodeEsc(str) {
    function pad(input) {
      const fill = '0000';
      return input.length > 3 ? input : fill.substr(0, 4 - input.length) + input;
    }

    let out = '';
    for (let i = 0, l = str.length; i < l; i++)
      out += '\\u' + pad(str.charCodeAt(i).toString(16));
    return out;
  };

  Utils.makeRawCollection = function makeRawCollection(collection) {
    const raw = collection.rawCollection();
    return {
      ensureIndex: (...args) => raw.createIndex(...args),
      createIndex: (...args) => raw.createIndex(...args),
      dropIndex: (...args) => raw.dropIndex(...args),
      dropIndexes: (...args) => raw.dropIndexes(...args),
      aggregate: (...args) => raw.aggregate(...args).toArray(),
      find: (...args) => raw.find(...args).toArray(),
      count: (...args) => raw.countDocuments(...args)
    };
  };

  Utils.makeRawCollectionAsync = Utils.makeRawCollection;

  Utils.getCompanyIdForUserAsync = async function (userId) {
    let companyId;
    if (userId) {
      const user = await Meteor.users.findOneAsync(userId);
      if ((user && (user.emails && user.emails[0].verified) || !user.emails) && user.profile) {
        companyId = user.profile.companyId;
      }
    }
    return companyId;
  };

  Utils.getCompanyIdForUser = Utils.getCompanyIdForUserAsync;

  Utils.getStage = function () {
    return process && process.env && process.env.ROOT_URL;
  };

  Utils.Rating.scale = function (value, originalMin, originalMax) {
    const self = Utils.Rating;

    if (_.isNumber(value) === false) {
      throw new TypeError('"value" must be a number');
    }
    if (_.isNumber(originalMin) === false) {
      throw new TypeError('"originalMin" must be a number');
    }
    if (_.isNumber(originalMax) === false) {
      throw new TypeError('"originalMax" must be a number');
    }

    return Math.round(self.MINUSMINUS + (((value - originalMin) * (self.PLUSPLUS - self.MINUSMINUS))
      / (originalMax - originalMin)));
  };

  Utils.checkIfAdmin = function () {
    throw new Meteor.Error(403, 'Access Denied');
  };

  Utils.checkIfAdminOrComponentManagerAsync = async function () {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user, ['company_component_manager'],user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return user;
  };

  Utils.checkIfAdminOrComponentManager = Utils.checkIfAdminOrComponentManagerAsync;

  Utils.walkMap = async function(dependency, list, critical) {
    let data;
    let component;
    let key = dependency.key || dependency.moduleIdentifier;
    let moduleId = dependency.moduleId;
    if(key){
      let filterQ = {key: key}
      let filter = filterQ
      if(critical){
        filter = {$and:[RestApi.getFilterCritical(), filterQ]}
      }
      if(key.indexOf('im:') === 0){
        component = await InfrastructureComponents.findOneAsync(filter);
      }else{
        component = await Components.findOneAsync(filter);
      }
      if (component) {
        data = mapComponent(dependency, component)
        list.push(JSON.parse(JSON.stringify(data)));
        data.dependencies = dependency.dependencies
      }
    }
    if(!component){
      data = mapModule(dependency)
      data.dependencies = dependency.dependencies
    }
    if (data && data.dependencies instanceof Array) {
      const mapped = [];
      for (const d of data.dependencies) {
        if(!d.moduleId){
          d.moduleId = moduleId;
        }
        mapped.push(await Utils.walkMap(d, list, critical));
      }
      data.dependencies = mapped;
    }
    return data
  }

  // A key may call an endpoint when its scope shares a role with `roles` (or the
  // endpoint names none). A key without a scope has no access: it used to pass
  // every check.
  Utils.validateKeyScope = function (key, roles){
    if(!key || !Array.isArray(key.scope) || !key.scope.length){
      return false
    }
    if(!roles || !roles.length){
      return true
    }
    return key.scope.some(value => roles.includes(value))
  }

  return Utils;
})(Utils);

function mapComponent(proComp, component) {
  const result = {
    _id: component._id,
    name: component.getName(),
    key: component.getKey(),
    moduleId: proComp.moduleId
  };
  if (component.getUrl('homepage')) {
    result.homepageUrl = component.getUrl('homepage');
  }
  const crypto_algorithms = component.getAlgorithms();
  if(crypto_algorithms && crypto_algorithms.length){
    result.crypto_algorithms = crypto_algorithms;
  }
  // A component flagged as an AI/ML artifact in the component lake surfaces on the BOM
  // tree node, so the AIBOM export picks it up even when the current scan did not carry
  // the marker (parallel to crypto_algorithms above / CBOM).
  const ai_models = component.getAiModels && component.getAiModels();
  if(ai_models && ai_models.length){
    result.ai_models = ai_models;
  }
  if(proComp.versions){
    proComp.versions.forEach(function (v) {
      const version = component.findVersion(v);
      if (version) {
        // The version belongs on the row whether or not a license was matched. Setting
        // it inside the licenses loop dropped it entirely for every component whose
        // version carries none, leaving a BOM row with a key but no version.
        result.version = v;
        version.getLicenses(component.getDeclaredLicenses()).forEach(function (lic) {
          result.license = lic.getName();
          result.licenseUrl = lic.getUrl();
          result.licenseKey = lic.getKey();
        });
        result.copyright = version.getCopyright();
      }
    });
  }

  return result;
}

function mapModule(moduleData) {
  return {
    name: moduleData.name || moduleData.module,
    key: moduleData.moduleIdentifier,
    description: moduleData.description,
    version: moduleData.version,
    moduleId: moduleData.moduleId
  };
}

