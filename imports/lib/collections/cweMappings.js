import {Mongo} from 'meteor/mongo';
import {CweMappingSchema} from '../schemas/cweMappingSchema';

const CweMappings = new Mongo.Collection('cweMappings');

CweMappings.attachSchema(CweMappingSchema);
export default CweMappings;
