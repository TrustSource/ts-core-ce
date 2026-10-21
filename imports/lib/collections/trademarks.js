import {Mongo} from 'meteor/mongo';
import {TrademarkSchema} from '../schemas/trademarkSchema';

const Trademarks = new Mongo.Collection('trademarks');

Trademarks.attachSchema(TrademarkSchema);
export default Trademarks;
