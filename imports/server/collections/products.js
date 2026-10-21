import {Meteor} from 'meteor/meteor';
import Products from '/imports/lib/collections/products';
import Utils from '../ServerUtils';

Meteor.publish('products', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if(user && user.profile && user.profile.companyId){
    const companyId = user.profile.companyId;
    return Products.find({companyId}, {fields:{properties:0}});
  }
  this.ready();
});

Meteor.publish('productDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    const companyId = user.profile.companyId;
    return Products.find({companyId, _id});
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
Products.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

export let RawProducts;

Meteor.startup(function () {
  RawProducts = Utils.makeRawCollection(Products);
  RawProducts.createIndex('submitted');
  RawProducts.createIndex('companyId');
  RawProducts.createIndex('state');
  RawProducts.createIndex('identifier');
});


