import {Mongo} from 'meteor/mongo';

// Full OSV records, one per OSV id, written only by the analysis worker
// (workers/analysis/services/osv). Shared by every tenant; no client writes (no allow rules).
const OsvVulns = new Mongo.Collection('osvVulns');

export default OsvVulns;
