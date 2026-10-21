import updateProduct from './update';

const supportRemove = async function (props, apiUser) {
  const modifier = {
    $pull: {
      supportContracts: {
        _id: props.support._id
      }
    }
  }
  return await updateProduct(modifier, props.product._id, apiUser);
};

export default supportRemove;
