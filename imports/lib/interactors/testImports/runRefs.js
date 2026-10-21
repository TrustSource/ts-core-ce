import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Scans from '/imports/lib/collections/scans';

// A test run may name the analysis and scan it belongs to. Each one it names must be
// of the caller's company and, when the run names a module, of that module; otherwise
// a run could be filed under another company's analysis or scan.
//
// Server-side only: in the browser the analyses and scans are not all published, so a
// missing document there proves nothing.
export async function runRefsBelongTo({companyId, moduleId, analysisId, scanId}) {
  if (!companyId) {
    return false;
  }
  const scope = moduleId ? {companyId, moduleId} : {companyId};
  for (const [collection, id] of [[ModuleAnalysis, analysisId], [Scans, scanId]]) {
    if (id === undefined || id === null) {
      continue;
    }
    if (typeof id !== 'string' || !id) {
      return false;
    }
    if (!await collection.findOneAsync(Object.assign({_id: id}, scope), {fields: {_id: 1}, transform: null})) {
      return false;
    }
  }
  return true;
}
