import {Mongo} from 'meteor/mongo';
import Component from '../component/Component';

const Components = new Mongo.Collection('components', {
  transform: function (doc) {
    return new Component(doc);
  }
});

export default Components;

