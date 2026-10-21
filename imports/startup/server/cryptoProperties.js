import {Meteor} from 'meteor/meteor';
import {CryptoPropertiesCreate, CryptoPropertiesRemove, CryptoPropertiesUpdate,
  CryptoPropertiesFind} from '/imports/lib/interactors/cryptoProperties';

Meteor.methods({
  'CryptoProperties.Create': async function (...args) { return await CryptoPropertiesCreate.apply(this, args); },
  'CryptoProperties.Update': async function (...args) { return await CryptoPropertiesUpdate.apply(this, args); },
  'CryptoProperties.Remove': async function (...args) { return await CryptoPropertiesRemove.apply(this, args); },
  'CryptoProperties.Find': async function (...args) { return await CryptoPropertiesFind.apply(this, args); }
});
