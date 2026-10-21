// Pure, dependency-free helpers for the SBOM file details view.
// CommonJS and free of Meteor/Blaze/jQuery so the Jest harness can require it
// directly (same pattern as riskOrigin.js) - the slice-color
// and dropdown-variant logic are unit-tested in isolation while the CSS/Blaze
// rendering is QA-verified.

// Progress pie slice colors, chosen by theme at render time. The done slice is
// teal (#2a94a2) in both themes; the remaining slice is dark (#373737,
// @color-bg-lightest) in dark mode and light (#eeeeee) otherwise, so the
// "remaining" arc never renders white-on-dark.
function getChartSliceColors(isDark) {
  return isDark ? ['#2a94a2', '#373737'] : ['#2a94a2', '#eeeeee'];
}

// Maps a CycloneDX dropdown variant to the getCycloneDxDetails type argument
// and the download filename suffix. FULL is the combined (no-type) export, so
// its type is undefined and it keeps the historical -sbom-file- suffix. Unknown
// variants fall back to plain SBOM.
function getCycloneDxVariant(variant) {
  switch (variant) {
  case 'CBOM':
    return {type: 'CBOM', suffix: '-cbom-file-'};
  case 'AIBOM':
    return {type: 'AIBOM', suffix: '-aibom-file-'};
  case 'FULL':
    return {type: undefined, suffix: '-sbom-file-'};
  case 'SBOM':
  default:
    return {type: 'SBOM', suffix: '-sbom-file-'};
  }
}

module.exports = {getChartSliceColors, getCycloneDxVariant};
