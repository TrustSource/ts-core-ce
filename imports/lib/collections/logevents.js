import {Mongo} from 'meteor/mongo';
import LogEvent from '/imports/lib/models/logEvent';

const LogEvents = new Mongo.Collection('logevents', {
  transform: function (doc) {
    return new LogEvent(doc);
  }
});
export default LogEvents;
