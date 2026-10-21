import {Mongo} from 'meteor/mongo';
import {CSAFSchema} from '/imports/lib/schemas/csafSchema';

const CSAF = new Mongo.Collection('csaf');

CSAF.attachSchema(CSAFSchema);

export default CSAF;


