import {Meteor} from 'meteor/meteor';
import updateProduct from './update';
import ApprovalReports from '/imports/lib/collections/approvalReports';

const linkWithRelease = async function (props, apiUser) {
  let user = await Meteor.userAsync();
  if(!user){
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }
  const approvalCapabilities = await ApprovalReports.findOneAsync({approveId: props.approval._id,
    companyId: user.profile.companyId, type: 'capabilities'});
  const list = (approvalCapabilities && approvalCapabilities.data && approvalCapabilities.data.list) || []
  const approval = props.approval
  approval.capabilities = list.map(item=>{
    let {name, version, description} = item;
    return {name, version, description}
  })
  const modifier = {
    $addToSet: {
      solutions: approval
    }
  }
  return await updateProduct(modifier, props.product._id, user);
};

export default linkWithRelease;
