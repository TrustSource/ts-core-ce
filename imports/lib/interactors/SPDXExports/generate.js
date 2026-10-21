import {Meteor} from 'meteor/meteor';
import path from 'path';
import fs from 'fs';
import {moment} from 'meteor/momentjs:moment';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Utils from '/imports/server/ServerUtils';
import SPDXExports from '/imports/lib/collections/SPDXExports';
import Modules from '/imports/lib/collections/modules';
import {SPDXFilesCreate} from '/imports/lib/interactors/SPDXFiles';
import {ModulesGetComponents} from '/imports/lib/interactors/modules';
import unlinkFile from '/imports/lib/interactors/unlinkFile';
import {SPDXTypes, SPDXGenerate} from '/imports/lib/spdx';
import {Config} from '/imports/config';
import Companies from '/imports/lib/collections/companies';

// Created by the company that exports the module, with this application.
const CreationInfo = function (company) {
  return {
    DateCreated: moment().format('YYYY-MM-DDThh:mm:ss\\Z'),
    Organization: (company && company.name) || Config.name,
    Tool: `${Config.name} ${Config.version}`
  }
};

const Package = function ({name, key, versions, urls, files, dependencies}) {
  const version = (versions || [])[0] || {};
  const licenses = Utils.getLicensesLabels()
    .filter(({value}) => ['NO-LICENSE', 'JAI-JDL', 'Indiana-1.1.1'].findIndex(item => item === value) === -1);
  const license = (version.licenses || [])
    .map(({key}) => (licenses.find(({value}) => value === key) || {}).value)
    .filter(value => value)[0] || 'Unlicense';
  urls = urls || {};
  let data = {
    Name: name,
    SPDXID: key,
    LicenseId: license,
    DownloadURL: urls.repository || urls.homepage || 'http://spdx.org/rdf/terms#noassertion',
    Homepage: urls.homepage,
    Version: version.version,
    CopyrightText: `Copyright 2000-2023 ${name}`,
    LicenseIdFromFile: license,
    LicenseIdDeclared: license
    // LicenseIdFromFile It needs only for root component
    // LicenseIdDeclared It needs only for root component
  };
  if (files && files.length > 0) {
    data.Files = files.map(() => File());
  }
  if (dependencies && dependencies.length > 0) {
    data.Packages = dependencies.map((component) => Package(component));
  }
  return data;
};

const File = function () {
  return {
    Name: '1',
    FileName: './package/foo.c',
    Checksum: 'd6a770ba38583ed4bb4525bd96e50461655d2758',
    CopyrightText: 'Copyright 2008-2010 John Smith',
    licenseId: 'GPL-2.0',
    licenseConcluded: 'LGPL-2.0'
  };
};

const tmpPath = path.join(Config.METEOR_UPLOAD_FOLDER+'/spdx');

const generateXmlObject = async function (SPDXExportID) {
  const SPDXExportObj = await SPDXExports.findOneAsync(SPDXExportID);
  const companyId = await Utils.getCompanyIdForUserAsync(SPDXExportObj.userId);
  const module = await Modules.findOneAsync({_id: SPDXExportObj.moduleId, companyId: companyId}, {
    fields: {
      name: 1,
      analysis: {$slice: -1}
    }
  });
  const components = await ModulesGetComponents(module);
  const component = components.length === 0 || components.length > 1 ? {name: module.name, dependencies: components} : components[0];
  let spdxObject = {
    DocumentNamespace: Router.routes['SPDXExport'].url({documentName:
        Utils.cleanAndFixIdentifier(module.name.replace(/[^a-zA-Z.-]/, '-')), uuid: SPDXExportObj.uuid}),
    Name: module.name,
    CreationInfo: CreationInfo(await Companies.findOneAsync(companyId, {fields: {name: 1}})),
    Package: Package(component)
  };
  return SPDXGenerate(spdxObject);
};

const updateSPDXExports = async function(SPDXExportID, {type, fileObject}) {
  const data = {};
  data[`${type}FileId`] = fileObject._id;
  await SPDXExports.updateAsync(SPDXExportID, {$set: data});
};

const generateRDF = async function({SPDXExportID, fileName, filePath}) {
  await SPDXExports.updateAsync(SPDXExportID, {$set: {status: 'generating rdf file'}});
  const xmlObject = await generateXmlObject(SPDXExportID);
  if (!fs.existsSync(tmpPath)) {
    fs.mkdirSync(tmpPath, {recursive: true});
  }
  await new Promise((resolve, reject) => {  
    let writeStream = fs.createWriteStream(filePath);
    writeStream.on('open', Meteor.bindEnvironment(function() {
      writeStream.write(xmlObject);
      writeStream.end();
      resolve();
    }));
    writeStream.on('error', reject);
  });
  const fileObject = await SPDXFilesCreate({SPDXExportID, fileName, filePath, type: 'rdf'});
  await updateSPDXExports(SPDXExportID, {type: 'rdf', fileObject});
};

const generate = async function (SPDXExportID) {
  const fileName = `${SPDXExportID}_${moment(new Date()).format('YYYY-MM-DD-HHMMss')}${SPDXTypes['rdf'].ext}`;
  const filePath = path.join(tmpPath, fileName);
  await generateRDF({SPDXExportID, fileName, filePath});
  await SPDXExports.updateAsync(SPDXExportID, {$set: {status: 'finished'}});
  unlinkFile(filePath);
};

export default generate;
