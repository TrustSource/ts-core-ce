const E = require('./enums');

function isEmpty(v) {
  return v === undefined || v === null || v === '' ||
    (Array.isArray(v) && v.length === 0);
}

// Build a stored AiProperties payload from flat form values. Keeps only the structured
// ML_MODEL_PROP_KEYS allowlist (empties dropped) and preserves a raw CycloneDX modelCard
// passthrough verbatim when one is supplied. Mirrors cryptoForm.buildCryptoPayload.
function buildAiModelPayload(values) {
  const payload = {assetType: E.ML_ASSET_TYPE};
  E.ML_MODEL_PROP_KEYS.forEach((key) => {
    const value = values ? values[key] : undefined;
    if (!isEmpty(value)) payload[key] = value;
  });
  if (values && values.modelCard && typeof values.modelCard === 'object') {
    payload.modelCard = values.modelCard;
  }
  return payload;
}

module.exports = {buildAiModelPayload, ML_MODEL_PROP_KEYS: E.ML_MODEL_PROP_KEYS};
