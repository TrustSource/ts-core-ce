import {Mongo} from 'meteor/mongo';
import {TestToolSchema} from '../schemas/testToolSchema';

const TestTools = new Mongo.Collection('testTools');

TestTools.attachSchema(TestToolSchema);
export default TestTools;
