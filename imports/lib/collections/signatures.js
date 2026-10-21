import {Mongo} from 'meteor/mongo';
import {SignatureSchema} from '../schemas/signatureSchema';

const Signatures = new Mongo.Collection('signatures');

Signatures.attachSchema(SignatureSchema);

export default Signatures;


