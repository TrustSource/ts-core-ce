const E = require('./enums');

const FIELD_BY_ASSET = {
  algorithm: {field: 'algorithmProperties', keys: E.ALGORITHM_PROP_KEYS},
  certificate: {field: 'certificateProperties', keys: E.CERTIFICATE_PROP_KEYS},
  protocol: {field: 'protocolProperties', keys: E.PROTOCOL_PROP_KEYS},
  'related-crypto-material': {
    field: 'relatedCryptoMaterialProperties', keys: E.RELATED_MATERIAL_PROP_KEYS
  }
};

function isEmpty(v) {
  return v === undefined || v === null || v === '' ||
    (Array.isArray(v) && v.length === 0);
}

// Build a stored CryptoProperties payload from flat form values. Storage keeps the
// raw entered values (strings); the writer (Plan 1) coerces/cleans on emit. Only the
// selected asset type's allowed keys are kept; empties are dropped.
function buildCryptoPayload(assetType, values) {
  const type = FIELD_BY_ASSET[assetType] ? assetType : 'algorithm';
  const spec = FIELD_BY_ASSET[type];
  const props = {};
  spec.keys.forEach((key) => {
    const value = values ? values[key] : undefined;
    if (!isEmpty(value)) props[key] = value;
  });
  const payload = {assetType: type};
  payload[spec.field] = props;
  return payload;
}

module.exports = {buildCryptoPayload, FIELD_BY_ASSET};
