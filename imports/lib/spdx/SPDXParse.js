import {xml2js as xmlParse} from './xmlCompat';
import _ from 'underscore';
import constants from './SPDXRDFConstants';

const RDF_RESOURCE = 'rdf:resource'

function replaceAll(str, list, replace) {
  if(str){
    let rezLine = str;
    _.each(list, function (character) {
      rezLine = rezLine.replace(character, replace);
    });
    return rezLine
  }else{
    return ''
  }
}

let cacheComponents = {};
export const Element = (js) => ({
  js: js,
  getElement(name, required) {
    required === undefined && (required = true);
    const element = (this.js.elements || []).find((element) => element.type === 'element' && element.name === name);
    if (required && !element) {
      // console.log(this.js.elements);
      throw new Error(`Can't find element "${name}"`);
    }
    return element ? Element(element) : null;
  },
  getElements(name, required) {
    required === undefined && (required = true);
    const elements = (this.js.elements || []).filter((element) => element.type === 'element' && element.name === name);
    if (required && !elements) {
      // console.log(this.js.elements);
      throw new Error(`Can't find any element "${name}"`);
    }
    return elements.map(element => Element(element));
  },
  getText(required) {
    required === undefined && (required = true);
    const element = (this.js.elements || []).find((element) => element.type === 'text');
    if (required && !element) {
      // console.log(this.js.elements);
      throw new Error('Can\'t find element "text"');
    }
    return element ? element.text : null;
  },
  getElementText(name, text, required) {
    if (text){
      const element = this.getElements(name, required).find(element => element.getText().match(text));
      return element && element.getText(false).replace(`${text} `, '');
    } else {
      const element = this.getElement(name, required);
      return element && element.getText(false);
    }
  },
  getFiles() {
    const hasFile = this.getElement(`${constants.SPDX}:${constants.PROP_PACKAGE_FILE}`, false);
    if (!hasFile) {
      return [];
    }
    return hasFile.getElements(`${constants.SPDX}:${constants.CLASS_SPDX_FILE}`).map(file => ({
      Name: file.getAttribute('rdf:about').match(`#${constants.SPDX_ELEMENT_REF_PRENUM}(.*)`)[1],
      FileName: file.getElementText(`${constants.SPDX}:${constants.PROP_FILE_NAME}`),
      Checksum: file.getElement(`${constants.SPDX}:${constants.PROP_FILE_CHECKSUM}`)
        .getElement(`${constants.SPDX}:${constants.CLASS_SPDX_CHECKSUM}`)
        .getElementText(`${constants.SPDX}:${constants.PROP_CHECKSUM_VALUE}`),
      CopyrightText: file.getElementText(`${constants.SPDX}:${constants.PROP_FILE_COPYRIGHT}`),
      licenseId: file.getLicenceId(`${constants.SPDX}:${constants.PROP_FILE_SEEN_LICENSE}`),
      licenseConcluded: file.getLicenceId(`${constants.SPDX}:${constants.PROP_FILE_LICENSE}`)
    }));
  },
  getPackageInfo() {
    const SPDXIDAttribute = this.getAttribute('rdf:about', false);
    const VerificationCodeElement = this.getElement(`${constants.SPDX}:${constants.PROP_PACKAGE_VERIFICATION_CODE}`, false);
    cacheComponents[SPDXIDAttribute] = {
      Name: this.getElementText(`${constants.SPDX}:${constants.PROP_PACKAGE_DECLARED_NAME}`, null, false),
      SPDXID: SPDXIDAttribute && SPDXIDAttribute.match(`#${constants.SPDX_ELEMENT_REF_PRENUM}(.*)`)[1],
      LicenseId: this.getLicenceId(`${constants.SPDX}:${constants.PROP_PACKAGE_CONCLUDED_LICENSE}`),
      DownloadURL: this.getElementText(`${constants.SPDX}:${constants.PROP_PACKAGE_DOWNLOAD_URL}`, null, false),
      Homepage: this.getElementText(`doap:${constants.PROP_PROJECT_HOMEPAGE}`, null, false),
      Version: replaceAll(this.getElementText(`${constants.SPDX}:${constants.PROP_PACKAGE_VERSION_INFO}`, null, false),
        ['>','<','=','^','~'],'').trim(),
      VerificationCode: VerificationCodeElement && VerificationCodeElement
        .getElement(`${constants.SPDX}:${constants.CLASS_SPDX_VERIFICATIONCODE}`)
        .getElementText(`${constants.SPDX}:${constants.PROP_VERIFICATIONCODE_VALUE}`, null, false),
      CopyrightText: this.getElementText(`${constants.SPDX}:${constants.PROP_PACKAGE_DECLARED_COPYRIGHT}`, null, false),
      LicenseIdFromFile: this.getLicenceId(`${constants.SPDX}:${constants.PROP_PACKAGE_LICENSE_INFO_FROM_FILES}`),
      LicenseIdDeclared: this.getLicenceId(`${constants.SPDX}:${constants.PROP_PACKAGE_DECLARED_LICENSE}`),
      Description: this.getElementText(`${constants.PROP_PACKAGE_DESCRIPTION}`, null, false),
      Files: this.getFiles(),
      Packages: this.getPackages()
    };
    return cacheComponents[SPDXIDAttribute];
  },
  getPackage() {
    return (this.getRelation('contains').getElement(`${constants.SPDX}:${constants.CLASS_SPDX_PACKAGE}`, false) ||
      this.getRelation('describes').getElement(`${constants.SPDX}:${constants.CLASS_SPDX_PACKAGE}`, false)).getPackageInfo();
  },
  getPackages() {
    return this.getRelations('contains').map(element => {
      const resource = element.getAttribute(RDF_RESOURCE, false);
      if (resource) {
        if (cacheComponents[resource] == undefined) throw new Error(`${resource} cannot be fetched from cache`);
        console.log(`Fetching ${resource} from cache.`);
        return cacheComponents[resource];
      }
      return element.getElement(`${constants.SPDX}:${constants.CLASS_SPDX_PACKAGE}`).getPackageInfo();
    });
  },
  getLicenceId(name) {
    let licenseId = this.getElementAttribute(name, RDF_RESOURCE, false);
    if (!licenseId) {
      const element = this.getElement(name, false);
      licenseId = element && element.getElementAttribute(`${constants.SPDX}:${constants.CLASS_SPDX_LICENSE}`, 'rdf:about', false);
    }
    // eslint-disable-next-line
    return licenseId ? licenseId.replace(`${constants.STANDARD_LICENSE_URL}\/`, '') : null;
  },
  getRelation(type){
    return this.getRelations(type)[0]
  },
  getRelations(type) {
    return this.getElements(`${constants.SPDX}:${constants.PROP_RELATIONSHIP}`)
      .filter(element => element
        .getElement(`${constants.SPDX}:${constants.CLASS_RELATIONSHIP}`)
        .getElementAttribute(`${constants.SPDX}:${constants.PROP_RELATIONSHIP_TYPE}`, RDF_RESOURCE)
        .match(`${type}$`)
      ).map(element => element
        .getElement(`${constants.SPDX}:${constants.CLASS_RELATIONSHIP}`)
        .getElement(`${constants.SPDX}:${constants.PROP_RELATED_SPDX_ELEMENT}`)
      );
  },
  getElementAttribute(name, attribute, required) {
    const element = this.getElement(name, required);
    return element && element.getAttribute(attribute, required);
  },
  getAttribute(name, required) {
    required === undefined && (required = true);
    const attribute = (js.attributes ||{})[name];
    if (required && !attribute) {
      throw new Error(`Can't fetch attribute "${name}" from "${this.js.name}" element`);
    }
    return attribute;
  },
  getResult() {
    const rdf = this.getElement(constants.RDF_RDF);
    const document = rdf.getElement(`${constants.SPDX}:${constants.CLASS_SPDX_DOCUMENT}`);
    const creationInfo = document
      .getElement(`${constants.SPDX}:${constants.PROP_SPDX_CREATION_INFO}`)
      .getElement(`${constants.SPDX}:${constants.CLASS_SPDX_CREATION_INFO}`);
    return {
      DocumentNamespace: rdf.getAttribute('xmlns'),
      Name: document.getElementText(`${constants.SPDX}:${constants.PROP_PROJECT_NAME}`),
      CreationInfo: {
        DateCreated: creationInfo.getElementText(`${constants.SPDX}:${constants.PROP_CREATION_CREATED}`),
        Organization: creationInfo
          .getElementText(`${constants.SPDX}:${constants.PROP_CREATION_CREATOR}`, constants.CREATOR_PREFIX_ORGANIZATION),
        Tool: creationInfo.getElementText(`${constants.SPDX}:${constants.PROP_CREATION_CREATOR}`, constants.CREATOR_PREFIX_TOOL)
      },
      Package: document.getPackage()
    };
  }
});

export const parse = (xml) => {
  try {
    return Element(xmlParse(xml)).getResult();
  } catch (e){
    // console.log(e.stack);
    throw new Error(`Cannot parse RDF document: ${e.message}`, {cause: e});
  }
};

export default parse;
