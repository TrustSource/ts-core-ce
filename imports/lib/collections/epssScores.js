import {Mongo} from 'meteor/mongo';

// EPSS exploit-prediction scores cached from FIRST (api.first.org), one document
// per CVE id, written only by imports/startup/server/ts-epss.js while a
// vulnerability report is generated. Shared by every tenant - a CVE's score is a
// property of the CVE, not of a company - and never published to a client, so
// there are no allow rules.
//
// `epss: null` records that FIRST has no score for that id, so a report full of
// unscored findings does not ask again on every run.
const EpssScores = new Mongo.Collection('epssScores');

export default EpssScores;
