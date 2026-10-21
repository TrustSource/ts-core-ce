import {Mongo} from 'meteor/mongo';

// Requests per API key and day: {_id: '<keyId>:<YYYY-MM-DD>', companyId, keyId,
// day, date, count}. Written by the REST layer, read by the API keys page.
const ApiKeyUsage = new Mongo.Collection('apiKeyUsage');

export default ApiKeyUsage;
