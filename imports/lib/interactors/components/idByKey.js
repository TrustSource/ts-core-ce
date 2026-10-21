import Components from '/imports/lib/collections/components';

const idByKey = async function (key) {
  const comp = await Components.findOneAsync({$or:[{key: key.toLowerCase()}, {oldKey: key.toLowerCase()}]}, {fields: {_id: true}})
  return comp ? comp._id : null;
};

export default idByKey;
