import {Mongo} from 'meteor/mongo';

const LoginsHistory = new Mongo.Collection('loginsHistory');
export default LoginsHistory;

