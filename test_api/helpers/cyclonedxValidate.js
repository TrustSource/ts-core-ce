/* eslint-disable no-undef */
const {Validator} = require('jsonschema');
const schema = require('../../public/schemas/cyclonedx-1.7.schema.json');
const jsf = require('../../public/schemas/jsf-0.82.schema.json');

// Relative $refs in the 1.7 schema resolve against its $id base
// (http://cyclonedx.org/schema/). cryptography-defs + spdx schemas are not shipped,
// so register permissive stubs; jsf is shipped and registered for real.
const BASE = 'http://cyclonedx.org/schema/';

function makeValidator() {
  const v = new Validator();
  v.addSchema(jsf, BASE + 'jsf-0.82.schema.json');
  v.addSchema({}, BASE + 'spdx.schema.json');
  // Permissive stub: the 1.7 schema references these two fragments by name.
  v.addSchema(
    {definitions: {algorithmFamiliesEnum: {}, ellipticCurvesEnum: {}}},
    BASE + 'cryptography-defs.schema.json'
  );
  return v;
}

// Returns array of human-readable errors ([] when valid).
function validateCycloneDX(doc) {
  const v = makeValidator();
  const result = v.validate(doc, schema, {nestedErrors: true});
  return result.errors.map((e) => `${e.property} ${e.message}`);
}

module.exports = {validateCycloneDX};
