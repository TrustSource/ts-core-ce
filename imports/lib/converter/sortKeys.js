// Pure, dependency-free key sorting for the CSAF/VEX converter. CommonJS so the
// Jest harness can require it without Meteor - vex.js pulls in meteor/* packages
// and cannot be required serverless, so the helper lives here and vex.js
// re-exports it (same dual-consumption pattern as riskProperties/listQuery.js:
// Meteor imports via ESM interop, Jest requires directly).

// Recursively return a copy of `value` with every plain-object's keys sorted
// alphabetically (arrays keep their order, their elements are sorted). Only
// real object literals (constructor === Object) are recursed into, so class
// instances and other exotic objects are left as-is. Behaviour is unchanged
// from the original local implementation in vex.js.
function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = sortKeys(value[k]);
      return acc;
    }, {});
  }
  return value;
}

module.exports = {sortKeys};
