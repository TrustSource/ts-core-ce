import {Mongo} from 'meteor/mongo';
import {ProductSchema} from '/imports/lib/schemas/productSchema';

const Products = new Mongo.Collection('products');

Products.attachSchema(ProductSchema);

export default Products;


