import {Mongo} from 'meteor/mongo';
import {UpdateSchema} from '../schemas/updateSchema';

const Updates = new Mongo.Collection('updates');

Updates.attachSchema(UpdateSchema);
export default Updates;
