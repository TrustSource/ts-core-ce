import {Mongo} from 'meteor/mongo';
import COTSComponent from '../component/COTSComponent';

const COTSComponents = new Mongo.Collection('cotsComponents', {
  transform: function (doc) {
    return new COTSComponent(doc);
  }
});

export default COTSComponents;

