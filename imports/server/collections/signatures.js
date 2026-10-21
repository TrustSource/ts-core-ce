import {Meteor} from 'meteor/meteor';
import Signatures from '/imports/lib/collections/signatures';
import Utils from '../ServerUtils';


Meteor.methods({
  'Signatures.create': async function ({signature, type}) {
    if(signature && signature.signature && !await Signatures.findOneAsync({'signature.value':signature.signature.value})){
      return await Signatures.insertAsync({
        created: new Date(),
        type,
        signature: signature.signature
      });
    }
  },
  'Signatures.count': async function () {
    return await Signatures.find().countAsync();
  },
  'Signatures.findOne': async function (value) {
    return await Signatures.findOneAsync({'signature.value':value});
  }
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawSignatures;

Meteor.startup(function () {
  RawSignatures = Utils.makeRawCollection(Signatures);
  RawSignatures.createIndex('created');
  RawSignatures.createIndex('signature.value');
});

