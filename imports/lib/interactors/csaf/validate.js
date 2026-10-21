import {Meteor} from 'meteor/meteor';
import {Validator} from 'jsonschema';
import Utils from '/imports/lib/utils';
import CSAF_SCHEMA from '/public/schemas/csaf_json_schema.json';
import cvssV2Schema from '/public/schemas/cvss-v2.0.json';
import cvssV3Schema from '/public/schemas/cvss-v3.0.json';
import cvssV31Schema from '/public/schemas/cvss-v3.1.json';

const validate = async function ({file}) {
  if(!Utils.isJsonString(file)) {
    throw new Meteor.Error(400, 'Invalid file content. Please upload a CSAF (.json) file.');
  }
  try {
    let fileJson = JSON.parse(file)
    const v = new Validator();
    v.addSchema(cvssV2Schema, 'https://www.first.org/cvss/cvss-v2.0.json?20170531');
    v.addSchema(cvssV3Schema, 'https://www.first.org/cvss/cvss-v3.0.json?20170531');
    v.addSchema(cvssV31Schema, 'https://www.first.org/cvss/cvss-v3.1.json?20211103');
    const validity = v.validate(fileJson, CSAF_SCHEMA)
    if (validity.errors && validity.errors.length) {
      validity.__errorObject = 'CSAF:';
      let errorText = []
      validity.errors.forEach(function (key) {
        const msg = key.stack || `${key.property} ${key.message}`;
        errorText.push(msg);
      });
      throw new Meteor.Error(400, errorText.join('; '));
    }
  }catch (e) {
    throw new Meteor.Error(400, e.toString());
  }
  return true
};

export default validate;
