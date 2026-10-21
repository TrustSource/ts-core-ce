import {Mongo} from 'meteor/mongo';
import {RiskSchema} from '../schemas/riskSchema';

const RiskProperties = new Mongo.Collection('riskProperties');

RiskProperties.attachSchema(RiskSchema);

export default RiskProperties;

