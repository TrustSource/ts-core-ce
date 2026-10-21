import updateProduct from './update';

const misuseRemove = async function (props, apiUser) {
  const modifier = {
    $pull: {
      misuses: {
        _id: props.misuse._id
      }
    }
  }
  return await updateProduct(modifier, props.product._id, apiUser);
};

export default misuseRemove;
