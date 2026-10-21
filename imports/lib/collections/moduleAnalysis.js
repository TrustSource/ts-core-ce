import Analysis from '/imports/lib/project/Analysis';
import {Mongo} from 'meteor/mongo';

const ModuleAnalysis = new Mongo.Collection('analysis', {
  transform: function (doc) {
    return new Analysis(doc);
  }
});
export default ModuleAnalysis;

