// Pure, dependency-free helpers that expose a module's CVSS environmental
// (iCVSS) context for the read endpoints. CommonJS so the Jest harness can
// require them without Meteor; the REST files import them via ESM interop. This
// is the single source of truth shared by BOTH the module- and project-scoped
// environmental-context routes.

// Extract the Modified Attack Vector (MAV) letter from a CVSS vector string.
//   /(?:^|\/)MAV:([NALPX])(?=\/|$)/ - case-sensitive, MAV must sit at the start
//   or after a '/', and the single letter must be followed by '/' or end-of-string.
// Returns the letter (N|A|L|P), or null when the input is not a string, has no
// MAV token, or the MAV is X (explicitly "not defined").
function parseMav(vectorString) {
  if (typeof vectorString !== 'string') {
    return null;
  }
  const m = vectorString.match(/(?:^|\/)MAV:([NALPX])(?=\/|$)/);
  if (!m || m[1] === 'X') {
    return null;
  }
  return m[1];
}

// Project a module document onto the flat environmental-context shape.
//   {moduleId, projectId|null, name|null, ciaRequirements:{CR,IR,AR}|null,
//    environmentalConfig:{v2vectorString,v3vectorString,v4vectorString each null
//    when absent}, mav}
// ciaRequirements passes the stored discrete letters (X/L/M/H) through verbatim
// and is null when the module has none - we never synthesize an X. MAV is read
// from the v4 vector, then the v3 vector; the v2 vector is never inspected (CVSS
// v2 has no MAV metric).
function toEnvironmentalContext(module) {
  const mod = module || {};
  const cfg = mod.environmentalConfig || {};
  const cia = mod.ciaRequirements;
  const ciaRequirements = cia
    ? {CR: cia.CR, IR: cia.IR, AR: cia.AR}
    : null;
  const environmentalConfig = {
    v2vectorString: cfg.v2vectorString != null ? cfg.v2vectorString : null,
    v3vectorString: cfg.v3vectorString != null ? cfg.v3vectorString : null,
    v4vectorString: cfg.v4vectorString != null ? cfg.v4vectorString : null
  };
  const mav = parseMav(cfg.v4vectorString) || parseMav(cfg.v3vectorString) || null;
  return {
    moduleId: mod._id,
    projectId: mod.projectId != null ? mod.projectId : null,
    name: mod.name != null ? mod.name : null,
    ciaRequirements,
    environmentalConfig,
    mav
  };
}

module.exports = {parseMav, toEnvironmentalContext};
