import {Mongo} from 'meteor/mongo';
import InfrastructureComponent from '../component/InfrastructureComponent';

const InfrastructureComponents = new Mongo.Collection('infrastructureComponents', {
  transform: function (doc) {
    return new InfrastructureComponent(doc);
  }
});

export default InfrastructureComponents;

