import {Mongo} from 'meteor/mongo';
import {TestSchema} from '../schemas/testSchema';

const Tests = new Mongo.Collection('tests');

Tests.attachSchema(TestSchema);

export default Tests;


