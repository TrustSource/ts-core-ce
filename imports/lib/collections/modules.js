import Module from '/imports/lib/project/Module';
import {Mongo} from 'meteor/mongo';

const Modules = new Mongo.Collection('modules', {
  transform: function (doc) {
    return new Module(doc);
  }
});
export default Modules;

