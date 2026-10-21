import updateProduct from './update';

const unlinkWithRelease = async function (props, apiUser) {
  const modifier = {
    $pull: {
      solutions: {
        _id: props.approval._id
      }
    }
  }
  return await updateProduct(modifier, props.product._id, apiUser);
};

export default unlinkWithRelease;
